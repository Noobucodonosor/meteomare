require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SG_KEY = process.env.STORMGLASS_API_KEY || '';
const SG_LIMIT = parseInt(process.env.STORMGLASS_DAILY_LIMIT) || 500;

// ================================================================
// CACHE IN-MEMORY (TTL 15 minuti)
// Evita chiamate ridondanti: se più dispositivi (direttrice, comandante,
// reception) chiedono gli stessi dati, il server risponde dalla cache.
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
// BATCH WEATHER — Un'unica chiamata per N punti
// Open-Meteo supporta coordinate multiple separate da virgola.
// Riduce N chiamate a 1 sola.
// ================================================================
app.get('/api/batch-weather', async (req, res) => {
    const { points } = req.query; // JSON: [{lat,lon},...]
    if (!points) return res.status(400).json({ error: 'points required' });

    let pts;
    try { pts = JSON.parse(points); } catch { return res.status(400).json({ error: 'invalid points JSON' }); }

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
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Open-Meteo non raggiungibile', detail: e.message });
    }
});

// ================================================================
// BATCH MARINE — Un'unica chiamata per N punti (con swell per risacca)
// ================================================================
app.get('/api/batch-marine', async (req, res) => {
    const { points } = req.query;
    if (!points) return res.status(400).json({ error: 'points required' });

    let pts;
    try { pts = JSON.parse(points); } catch { return res.status(400).json({ error: 'invalid points JSON' }); }

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
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Open-Meteo Marine non raggiungibile', detail: e.message });
    }
});

// ================================================================
// STORMGLASS (multi-model, opzionale)
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
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Stormglass non raggiungibile', detail: e.message });
    }
});

// ================================================================
// USAGE DASHBOARD
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
// HEALTH / CONFIG
// ================================================================
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
    console.log(`  Limite SG:  ${SG_LIMIT} chiamate/giorno`);
    console.log('');
});
