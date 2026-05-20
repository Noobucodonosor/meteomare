const WebSocket = require('ws');
const https = require('https');

// Ligurian Sea bounding box (Portofino + Cinque Terre area)
const BBOX = [[43.8, 9.0], [44.5, 9.8]];

// NOTE: aisstream.io has an expired SSL cert as of 2026-05-20.
// This agent allows connection despite the cert issue.
// Remove when they renew their certificate.
const wsAgent = new https.Agent({ rejectUnauthorized: false });
const VESSEL_TTL = 30 * 60 * 1000; // 30 minutes
const PRUNE_INTERVAL = 5 * 60 * 1000; // prune every 5 min
const RECONNECT_DELAY = 10000; // 10s

const vessels = new Map();
let ws = null;
let connected = false;

function connect() {
    const key = process.env.AISSTREAM_API_KEY;
    if (!key) return;

    try {
        ws = new WebSocket('wss://stream.aisstream.io/v0/stream', { agent: wsAgent });

        ws.on('open', () => {
            connected = true;
            ws.send(JSON.stringify({
                APIKey: key,
                BoundingBoxes: [BBOX]
            }));
            console.log('  AIS:        ✓ connesso a aisstream.io');
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.MessageType === 'PositionReport') {
                    const pos = msg.Message?.PositionReport;
                    const meta = msg.MetaData;
                    if (!pos || !meta) return;
                    const mmsi = meta.MMSI;
                    vessels.set(mmsi, {
                        mmsi,
                        name: (meta.ShipName || '').trim() || `MMSI ${mmsi}`,
                        lat: pos.Latitude,
                        lon: pos.Longitude,
                        speed: pos.Sog ?? null, // SOG in knots (AIS native)
                        course: pos.Cog ?? null, // COG
                        heading: pos.TrueHeading !== 511 ? pos.TrueHeading : null,
                        type: meta.ShipType ?? 0,
                        ts: Date.now()
                    });
                }
            } catch {}
        });

        ws.on('close', () => {
            connected = false;
            setTimeout(connect, RECONNECT_DELAY);
        });

        ws.on('error', () => {
            connected = false;
        });
    } catch {
        setTimeout(connect, RECONNECT_DELAY);
    }
}

// Prune stale vessels
setInterval(() => {
    const cutoff = Date.now() - VESSEL_TTL;
    for (const [mmsi, v] of vessels) {
        if (v.ts < cutoff) vessels.delete(mmsi);
    }
}, PRUNE_INTERVAL);

module.exports = {
    name: 'ais',
    routes: [
        {
            method: 'get',
            path: '/api/ais',
            handler: async (req, res) => {
                res.json({
                    connected,
                    count: vessels.size,
                    vessels: Array.from(vessels.values()).map(v => ({
                        mmsi: v.mmsi,
                        name: v.name,
                        lat: v.lat,
                        lon: v.lon,
                        speed: v.speed,
                        course: v.course,
                        heading: v.heading,
                        type: v.type
                    }))
                });
            }
        }
    ],
    setup() {
        if (process.env.AISSTREAM_API_KEY) connect();
    },
    healthCheck() {
        return connected;
    }
};
