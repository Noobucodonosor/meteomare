require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const { cacheGet, cacheSet, cache, CACHE_TTL } = require('./lib/cache');
const { saveHistory, HISTORY_DIR, todayStr } = require('./lib/history');
const { track, getUsage } = require('./lib/usage');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
// DEPS — passati a ogni provider handler
// ================================================================
const deps = { cacheGet, cacheSet, saveHistory, track };

// ================================================================
// STATIC FILES
// ================================================================
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
// AUTO-LOAD PROVIDERS
// ================================================================
const providersDir = path.join(__dirname, 'providers');
const providers = [];

for (const file of fs.readdirSync(providersDir).filter(f => f.endsWith('.js'))) {
    const provider = require(path.join(providersDir, file));
    providers.push(provider);
    for (const route of provider.routes || []) {
        app[route.method](route.path, (req, res) => route.handler(req, res, deps));
    }
    // Optional lifecycle hooks (e.g., WebSocket setup)
    if (provider.setup) provider.setup(deps);
}

// ================================================================
// HISTORY — lettura snapshot passati
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
    const usage = getUsage();
    const SG_KEY = process.env.STORMGLASS_API_KEY || '';
    const SG_LIMIT = parseInt(process.env.STORMGLASS_DAILY_LIMIT) || 500;
    res.json({
        date: usage.date,
        stormglass: { calls: usage.stormglass || 0, limit: SG_LIMIT, remaining: Math.max(0, SG_LIMIT - (usage.stormglass || 0)), configured: !!SG_KEY },
        openmeteo: { calls: usage.openmeteo || 0, limit: 10000, remaining: 10000 - (usage.openmeteo || 0) },
        cache: { entries: cache.size, ttl_minutes: CACHE_TTL / 60000 },
    });
});

// ================================================================
// HEALTH
// ================================================================
app.get('/api/health', (req, res) => {
    const providerStatus = {};
    for (const p of providers) {
        providerStatus[p.name] = p.healthCheck ? p.healthCheck() : true;
    }
    res.json({
        status: 'ok',
        providers: providerStatus,
        stormglass: !!process.env.STORMGLASS_API_KEY,
        cache_entries: cache.size,
        uptime: process.uptime()
    });
});

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
    console.log('');
    console.log('  ⛵  MeteoMare — Promontorio di Portofino');
    console.log(`  ── http://localhost:${PORT}`);
    console.log('');
    console.log(`  Providers: ${providers.map(p => p.name).join(', ')}`);
    console.log(`  Stormglass: ${process.env.STORMGLASS_API_KEY ? '✓ configurato' : '✕ non configurato (solo Open-Meteo)'}`);
    console.log(`  Cache TTL:  ${CACHE_TTL / 60000} minuti`);
    console.log(`  Storico:    ${HISTORY_DIR}`);
    console.log('');
});
