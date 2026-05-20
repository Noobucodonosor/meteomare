const KN_PER_MS = 1.94384;

module.exports = {
    name: 'metno',
    routes: [
        {
            method: 'get',
            path: '/api/metno',
            handler: async (req, res, { cacheGet, cacheSet, track }) => {
                const { points } = req.query;
                if (!points) return res.status(400).json({ error: 'points required' });
                let pts;
                try { pts = JSON.parse(points); } catch { return res.status(400).json({ error: 'invalid JSON' }); }

                const cacheKey = `mn_${JSON.stringify(pts)}`;
                const cached = cacheGet(cacheKey);
                if (cached) return res.json(cached);

                try {
                    const results = await Promise.all(pts.map(async (pt) => {
                        const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${pt.lat}&lon=${pt.lon}`;
                        const r = await fetch(url, {
                            headers: { 'User-Agent': 'MeteoMare/1.0 github.com/meteomare' }
                        });
                        if (!r.ok) throw new Error(`MET Norway ${r.status}`);
                        return r.json();
                    }));

                    // Normalize: extract hourly data, convert to knots
                    const normalized = results.map((data, idx) => {
                        const hourly = {};
                        if (data.properties?.timeseries) {
                            for (const ts of data.properties.timeseries) {
                                const d = ts.time.substring(0, 10);
                                const h = parseInt(ts.time.substring(11, 13));
                                const inst = ts.data?.instant?.details || {};
                                hourly[`${d}T${String(h).padStart(2, '0')}`] = {
                                    wind: (inst.wind_speed || 0) * KN_PER_MS,
                                    gusts: (inst.wind_speed_of_gust || 0) * KN_PER_MS,
                                    windDir: inst.wind_from_direction || 0,
                                    temp: inst.air_temperature ?? null,
                                    pressure: inst.air_pressure_at_sea_level ?? null,
                                    humidity: inst.relative_humidity ?? null,
                                    cloudCover: inst.cloud_area_fraction ?? null,
                                };
                            }
                        }
                        return { lat: pts[idx].lat, lon: pts[idx].lon, hourly };
                    });

                    track('metno');
                    cacheSet(cacheKey, normalized);
                    res.json(normalized);
                } catch (e) {
                    res.status(502).json({ error: 'MET Norway non raggiungibile', detail: e.message });
                }
            }
        }
    ]
};
