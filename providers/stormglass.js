module.exports = {
    name: 'stormglass',
    routes: [
        {
            method: 'get',
            path: '/api/stormglass',
            handler: async (req, res, { cacheGet, cacheSet, saveHistory, track }) => {
                const SG_KEY = process.env.STORMGLASS_API_KEY || '';
                const SG_LIMIT = parseInt(process.env.STORMGLASS_DAILY_LIMIT) || 500;
                const { getUsage } = require('../lib/usage');
                const usage = getUsage();

                if (!SG_KEY) return res.status(400).json({ error: 'STORMGLASS_API_KEY non configurata' });
                if ((usage.stormglass || 0) >= SG_LIMIT) {
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
                    saveHistory('stormglass', [{ lat, lon }], data);
                    res.json(data);
                } catch (e) {
                    res.status(502).json({ error: 'Stormglass non raggiungibile', detail: e.message });
                }
            }
        }
    ]
};
