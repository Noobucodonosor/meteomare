module.exports = {
    name: 'gebco',
    routes: [
        {
            method: 'get',
            path: '/api/depth',
            handler: async (req, res, { cacheGet, cacheSet }) => {
                const { points } = req.query;
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
            }
        }
    ]
};
