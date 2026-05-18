require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SG_KEY = process.env.STORMGLASS_API_KEY || '';
const SG_LIMIT = parseInt(process.env.STORMGLASS_DAILY_LIMIT) || 500;

// ================================================================
// CACHE IN-MEMORY (TTL 15 minuti)
// ================================================================
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
    return entry.data;
}
function cacheSet(key, data) {
    cache.set(key, { ts: Date.now(), data });
}

// ================================================================
// STORICO — salva snapshot ogni fetch in JSON su disco
// Un file per giorno: data/history/YYYY-MM-DD.json
// Ogni entry: { ts, type, points, data }
// ================================================================
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
fs.mkdirSync(HISTORY_DIR, { recursive: true });

function saveHistory(type, points, data) {
    try {
        const today = todayStr();
        const file = path.join(HISTORY_DIR, `${today}.json`);
        let history = [];
        if (fs.existsSync(file)) {
            try { history = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        }
        // Limita a 1 snapshot per tipo ogni 15 min
        const lastOfType = history.filter(h => h.type === type).pop();
        if (lastOfType && Date.now() - new Date(lastOfType.ts).getTime() < CACHE_TTL) return;

        history.push({ ts: new Date().toISOString(), type, points, data });
        fs.writeFileSync(file, JSON.stringify(history));
    } catch (e) {
        console.warn('History save error:', e.message);
    }
}

// ================================================================
// TRACKING CONSUMI
// ================================================================
let usage = { date: todayStr(), stormglass: 0, openmeteo: 0 };

function todayStr() { return new Date().toISOString().split('T')[0]; }
function track(source) {
    if (usage.date !== todayStr()) usage = { date: todayStr(), stormglass: 0, openmeteo: 0 };
    usage[source]++;
}

// ================================================================
// STATIC FILES
// ================================================================
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
// BATCH WEATHER
// ================================================================
app.get('/api/batch-weather', async (req, res) => {
    const { points } = req.query;
    if (!points) return res.status(400).json({ error: 'points required' });
    let pts;
    try { pts = JSON.parse(points); } catch { return res.status(400).json({ error: 'invalid JSON' }); }

    const cacheKey = `bw_${JSON.stringify(pts)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const lats = pts.map(p => p.lat).join(',');
    const lons = pts.map(p => p.lon).join(',');
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}`
            + `&hourly=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,precipitation`
            + `&daily=sunrise,sunset&wind_speed_unit=kn&timezone=Europe/Rome&forecast_days=2`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
        const data = await r.json();
        track('openmeteo');
        cacheSet(cacheKey, data);
        saveHistory('weather', pts, data);
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Open-Meteo non raggiungibile', detail: e.message });
    }
});

// ================================================================
// BATCH MARINE
// ================================================================
app.get('/api/batch-marine', async (req, res) => {
    const { points } = req.query;
    if (!points) return res.status(400).json({ error: 'points required' });
    let pts;
    try { pts = JSON.parse(points); } catch { return res.status(400).json({ error: 'invalid JSON' }); }

    const cacheKey = `bm_${JSON.stringify(pts)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const lats = pts.map(p => p.lat).join(',');
    const lons = pts.map(p => p.lon).join(',');
    try {
        const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}`
            + `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction`
            + `&timezone=Europe/Rome&forecast_days=2`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Marine API ${r.status}`);
        const data = await r.json();
        track('openmeteo');
        cacheSet(cacheKey, data);
        saveHistory('marine', pts, data);
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Open-Meteo Marine non raggiungibile', detail: e.message });
    }
});

// ================================================================
// STORMGLASS — restituisce dati RAW per-modello (il frontend li mostra)
// ================================================================
app.get('/api/stormglass', async (req, res) => {
    if (!SG_KEY) return res.status(400).json({ error: 'STORMGLASS_API_KEY non configurata' });
    if (usage.date === todayStr() && usage.stormglass >= SG_LIMIT) {
        return res.status(429).json({ error: `Limite giornaliero (${SG_LIMIT}) raggiunto` });
    }

    const { lat, lon, start, end } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });

    const cacheKey = `sg_${lat}_${lon}_${start}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const params = 'windSpeed,gust,waveHeight,wavePeriod,visibility,windDirection,swellHeight,swellPeriod,swellDirection,waterTemperature,airTemperature';
    try {
        const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lon}&params=${params}&start=${start}&end=${end}`;
        const r = await fetch(url, { headers: { 'Authorization': SG_KEY } });
        if (r.status === 402) return res.status(402).json({ error: 'Quota Stormglass esaurita' });
        if (r.status === 401 || r.status === 403) return res.status(401).json({ error: 'Chiave non valida' });
        if (!r.ok) throw new Error(`SG ${r.status}`);
        const data = await r.json();
        track('stormglass');
        cacheSet(cacheKey, data);
        saveHistory('stormglass', [{lat, lon}], data);
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Stormglass non raggiungibile', detail: e.message });
    }
});

// ================================================================
// STORICO — leggi snapshot passati
// ================================================================
app.get('/api/history', (req, res) => {
    const { date } = req.query;
    const target = date || todayStr();
    const file = path.join(HISTORY_DIR, `${target}.json`);
    if (!fs.existsSync(file)) return res.json({ date: target, snapshots: [] });
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        res.json({ date: target, snapshots: data });
    } catch {
        res.json({ date: target, snapshots: [] });
    }
});

// Lista giorni disponibili
app.get('/api/history/dates', (req, res) => {
    try {
        const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort().reverse();
        res.json({ dates: files });
    } catch {
        res.json({ dates: [] });
    }
});

// ================================================================
// USAGE
// ================================================================
app.get('/api/usage', (req, res) => {
    if (usage.date !== todayStr()) usage = { date: todayStr(), stormglass: 0, openmeteo: 0 };
    res.json({
        date: usage.date,
        stormglass: { calls: usage.stormglass, limit: SG_LIMIT, remaining: Math.max(0, SG_LIMIT - usage.stormglass), configured: !!SG_KEY },
        openmeteo: { calls: usage.openmeteo, limit: 10000, remaining: 10000 - usage.openmeteo },
        cache: { entries: cache.size, ttl_minutes: CACHE_TTL / 60000 },
    });
});

// ================================================================
// BATIMETRIA — profondità mare (GEBCO via OpenTopoData, gratis)
// ================================================================
app.get('/api/depth', async (req, res) => {
    const { points } = req.query; // "lat1,lon1|lat2,lon2|..."
    if (!points) return res.status(400).json({ error: 'points required (lat,lon|lat,lon)' });

    const cacheKey = `depth_${points}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const url = `https://api.opentopodata.org/v1/gebco2020?locations=${points}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`GEBCO ${r.status}`);
        const data = await r.json();
        cacheSet(cacheKey, data);
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'GEBCO non raggiungibile', detail: e.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', stormglass: !!SG_KEY, cache_entries: cache.size, uptime: process.uptime() });
});

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
    console.log('');
    console.log('  ⛵  MeteoMare — Promontorio di Portofino');
    console.log(`  ── http://localhost:${PORT}`);
    console.log('');
    console.log(`  Stormglass: ${SG_KEY ? '✓ configurato' : '✕ non configurato (solo Open-Meteo)'}`);
    console.log(`  Cache TTL:  ${CACHE_TTL / 60000} minuti`);
    console.log(`  Storico:    ${HISTORY_DIR}`);
    console.log('');
});
