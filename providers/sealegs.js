module.exports = {
    name: 'sealegs',
    routes: [
        {
            method: 'get',
            path: '/api/sealegs',
            handler: async (req, res, { cacheGet, cacheSet, track }) => {
                const SL_KEY = process.env.SEALEGS_API_KEY || '';
                if (!SL_KEY) return res.status(400).json({ error: 'SEALEGS_API_KEY non configurata' });

                const { lat, lon } = req.query;
                if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });

                const cacheKey = `sl_${lat}_${lon}`;
                const cached = cacheGet(cacheKey);
                if (cached) return res.json(cached);

                try {
                    const url = `https://api.sealegs.ai/v3/spotcast`;
                    const r = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${SL_KEY}`
                        },
                        body: JSON.stringify({
                            latitude: parseFloat(lat),
                            longitude: parseFloat(lon),
                            forecast_days: 1
                        })
                    });
                    if (!r.ok) throw new Error(`SeaLegs ${r.status}`);
                    const data = await r.json();
                    track('sealegs');
                    cacheSet(cacheKey, data);
                    res.json(data);
                } catch (e) {
                    res.status(502).json({ error: 'SeaLegs AI non raggiungibile', detail: e.message });
                }
            }
        }
    ],
    healthCheck() {
        return !!process.env.SEALEGS_API_KEY;
    }
};
