require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SG_KEY = process.env.STORMGLASS_API_KEY || '';
const SG_LIMIT = parseInt(process.env.STORMGLASS_DAILY_LIMIT) || 500;

// ---- Tracking consumi API ----
let usage = { date: todayStr(), stormglass: 0, openmeteo: 0 };

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

function track(source) {
    if (usage.date !== todayStr()) {
        usage = { date: todayStr(), stormglass: 0, openmeteo: 0 };
    }
    usage[source]++;
}

// ---- Static files ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Proxy: Open-Meteo Weather ----
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
            + `&hourly=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,precipitation`
            + `&daily=sunrise,sunset&wind_speed_unit=kn&timezone=Europe/Rome&forecast_days=2`;
        const r = await fetch(url);
        const data = await r.json();
        track('openmeteo');
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Open-Meteo non raggiungibile' });
    }
});

// ---- Proxy: Open-Meteo Marine (con parametri swell per risacca) ----
app.get('/api/marine', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });
    try {
        const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
            + `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction`
            + `&timezone=Europe/Rome&forecast_days=2`;
        const r = await fetch(url);
        const data = await r.json();
        track('openmeteo');
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Open-Meteo Marine non raggiungibile' });
    }
});

// ---- Proxy: Stormglass (multi-model) ----
app.get('/api/stormglass', async (req, res) => {
    if (!SG_KEY) return res.status(400).json({ error: 'STORMGLASS_API_KEY non configurata nel .env' });

    // Controlla limite giornaliero
    if (usage.date === todayStr() && usage.stormglass >= SG_LIMIT) {
        return res.status(429).json({ error: `Limite giornaliero Stormglass raggiunto (${SG_LIMIT})` });
    }

    const { lat, lon, params, start, end } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });

    try {
        const p = params || 'windSpeed,gust,waveHeight,wavePeriod,visibility,windDirection,waterTemperature,airTemperature,precipitation,cloudCover,swellHeight,swellPeriod,swellDirection';
        const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lon}&params=${p}&start=${start}&end=${end}`;
        const r = await fetch(url, { headers: { 'Authorization': SG_KEY } });

        if (r.status === 402) {
            return res.status(402).json({ error: 'Quota Stormglass esaurita' });
        }
        if (r.status === 401 || r.status === 403) {
            return res.status(401).json({ error: 'Chiave Stormglass non valida' });
        }

        const data = await r.json();
        track('stormglass');
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Stormglass non raggiungibile' });
    }
});

// ---- Dashboard consumi ----
app.get('/api/usage', (req, res) => {
    if (usage.date !== todayStr()) {
        usage = { date: todayStr(), stormglass: 0, openmeteo: 0 };
    }
    res.json({
        date: usage.date,
        stormglass: {
            calls: usage.stormglass,
            limit: SG_LIMIT,
            remaining: Math.max(0, SG_LIMIT - usage.stormglass),
            configured: !!SG_KEY,
        },
        openmeteo: {
            calls: usage.openmeteo,
            limit: 10000,
            remaining: 10000 - usage.openmeteo,
        },
    });
});

// ---- Stato configurazione ----
app.get('/api/config', (req, res) => {
    res.json({
        stormglass: !!SG_KEY,
        port: PORT,
    });
});

// ---- Avvio ----
app.listen(PORT, () => {
    console.log('');
    console.log('  ⛵  MeteoMare — Promontorio di Portofino');
    console.log(`  ── http://localhost:${PORT}`);
    console.log('');
    console.log(`  Stormglass: ${SG_KEY ? '✓ configurato' : '✕ non configurato → solo Open-Meteo'}`);
    console.log(`  Limite giornaliero SG: ${SG_LIMIT} chiamate`);
    console.log('');
});
