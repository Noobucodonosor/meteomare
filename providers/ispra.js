const { parse } = require('node-html-parser');

// ISPRA Rete Mareografica Nazionale + Rete Ondametrica Nazionale
// Base URL: https://www.mareografico.it
// The site is a JS-heavy SPA — data is loaded dynamically
// We try to scrape the HTML, but this is inherently fragile
// La Spezia is the closest station to Portofino/Cinque Terre

const ISPRA_BASE = 'https://www.mareografico.it';

module.exports = {
    name: 'ispra',
    routes: [
        {
            method: 'get',
            path: '/api/ispra',
            handler: async (req, res, { cacheGet, cacheSet, track }) => {
                const cacheKey = 'ispra_spezia';
                const cached = cacheGet(cacheKey);
                if (cached) return res.json(cached);

                const result = {
                    ts: new Date().toISOString(),
                    buoy: 'La Spezia',
                    waveH: null,
                    wavePeak: null,
                    waveDir: null,
                    tideGauge: { level: null, station: 'La Spezia' },
                    source: 'mareografico.it',
                    note: null
                };

                // Try multiple approaches to get ISPRA data

                // Approach 1: Try the station-specific URLs
                const urls = [
                    `${ISPRA_BASE}/station?code=SP`,
                    `${ISPRA_BASE}/stazione?code=SP_098`,
                    `${ISPRA_BASE}/API/data?station=SP_098&type=PREMSL&last=24h`,
                ];

                for (const url of urls) {
                    try {
                        const r = await fetch(url, {
                            headers: { 'User-Agent': 'MeteoMare/1.0' },
                            redirect: 'follow',
                            signal: AbortSignal.timeout(8000)
                        });
                        if (!r.ok) continue;
                        const contentType = r.headers.get('content-type') || '';

                        if (contentType.includes('json')) {
                            // If we get JSON, try to parse it
                            const data = await r.json();
                            // Look for sea level or wave data in the response
                            if (Array.isArray(data)) {
                                const last = data[data.length - 1];
                                if (last?.value != null) {
                                    result.tideGauge.level = parseFloat(last.value);
                                    break;
                                }
                            } else if (data.level != null) {
                                result.tideGauge.level = parseFloat(data.level);
                                break;
                            }
                        } else {
                            // HTML — try to extract numbers
                            const html = await r.text();
                            const root = parse(html);
                            const cells = root.querySelectorAll('td');
                            // Look for the last numeric value that looks like sea level (small number)
                            for (let i = cells.length - 1; i >= 0; i--) {
                                const val = parseFloat(cells[i].text.trim());
                                if (!isNaN(val) && Math.abs(val) < 3) {
                                    result.tideGauge.level = val;
                                    break;
                                }
                            }
                            if (result.tideGauge.level != null) break;
                        }
                    } catch {}
                }

                if (result.tideGauge.level == null && result.waveH == null) {
                    result.note = 'Dati ISPRA non disponibili — il sito usa rendering JavaScript dinamico. Consultare direttamente www.mareografico.it';
                }

                track('ispra');
                cacheSet(cacheKey, result, 60 * 60 * 1000); // 60 min cache
                res.json(result);
            }
        }
    ],
    healthCheck() { return true; }
};
