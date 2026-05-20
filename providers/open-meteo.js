module.exports = {
    name: 'openmeteo',
    routes: [
        {
            method: 'get',
            path: '/api/batch-weather',
            handler: async (req, res, { cacheGet, cacheSet, saveHistory, track }) => {
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
                        + `&hourly=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,precipitation,relative_humidity_2m,pressure_msl,cloud_cover,uv_index`
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
            }
        },
        {
            method: 'get',
            path: '/api/batch-marine',
            handler: async (req, res, { cacheGet, cacheSet, saveHistory, track }) => {
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
                        + `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction,ocean_current_velocity,ocean_current_direction`
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
            }
        }
    ]
};
