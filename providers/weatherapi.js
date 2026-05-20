module.exports = {
    name: 'weatherapi',
    routes: [
        {
            method: 'get',
            path: '/api/tides',
            handler: async (req, res, { cacheGet, cacheSet, track }) => {
                const WAPI_KEY = process.env.WEATHERAPI_KEY || '';
                if (!WAPI_KEY) return res.status(400).json({ error: 'WEATHERAPI_KEY non configurata' });

                const { lat, lon } = req.query;
                if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });

                const cacheKey = `wapi_${lat}_${lon}`;
                const cached = cacheGet(cacheKey);
                if (cached) return res.json(cached);

                try {
                    const url = `https://api.weatherapi.com/v1/marine.json?key=${WAPI_KEY}&q=${lat},${lon}&days=2`;
                    const r = await fetch(url);
                    if (!r.ok) throw new Error(`WeatherAPI ${r.status}`);
                    const raw = await r.json();
                    track('weatherapi');

                    // Normalize tide data
                    const result = { lat: parseFloat(lat), lon: parseFloat(lon), days: [] };
                    if (raw.forecast?.forecastday) {
                        for (const day of raw.forecast.forecastday) {
                            const tides = [];
                            if (day.day?.tides?.[0]?.tide) {
                                for (const t of day.day.tides[0].tide) {
                                    tides.push({
                                        time: t.tide_time,
                                        height: parseFloat(t.tide_height_mt) || 0,
                                        type: t.tide_type // HIGH or LOW
                                    });
                                }
                            }
                            // Water temp from hourly (first hour as representative)
                            const waterTemp = day.hour?.[12]?.water_temp_c ?? day.hour?.[0]?.water_temp_c ?? null;

                            result.days.push({
                                date: day.date,
                                tides,
                                waterTemp: waterTemp != null ? parseFloat(waterTemp) : null
                            });
                        }
                    }

                    cacheSet(cacheKey, result);
                    res.json(result);
                } catch (e) {
                    res.status(502).json({ error: 'WeatherAPI non raggiungibile', detail: e.message });
                }
            }
        }
    ],
    healthCheck() {
        return !!process.env.WEATHERAPI_KEY;
    }
};
