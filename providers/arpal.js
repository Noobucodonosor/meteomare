const { parse } = require('node-html-parser');

// ARPAL Liguria — bollettino meteo e stazioni
// URLs verified 2026-05-20: redirect to /tematiche/meteo/...
// The site is Joomla-based, content is HTML — parsing is fragile
const BULLETIN_URL = 'https://www.arpal.liguria.it/tematiche/meteo/bollettino-liguria.html';

module.exports = {
    name: 'arpal',
    routes: [
        {
            method: 'get',
            path: '/api/arpal',
            handler: async (req, res, { cacheGet, cacheSet, track }) => {
                const cacheKey = 'arpal_all';
                const cached = cacheGet(cacheKey);
                if (cached) return res.json(cached);

                const result = { ts: new Date().toISOString(), seaBulletin: null, source: 'arpal.liguria.it' };

                // Fetch sea/weather bulletin from ARPAL
                try {
                    const r = await fetch(BULLETIN_URL, {
                        headers: { 'User-Agent': 'MeteoMare/1.0' },
                        redirect: 'follow',
                        signal: AbortSignal.timeout(10000)
                    });
                    if (r.ok) {
                        const html = await r.text();
                        const root = parse(html);
                        // Try multiple selectors — Joomla HTML varies
                        const selectors = ['.com-content-article__body', '.item-page', 'article', '.field-item', '#article-content', '.blog-item'];
                        for (const sel of selectors) {
                            const el = root.querySelector(sel);
                            if (el) {
                                const text = el.text.replace(/\s+/g, ' ').trim();
                                if (text.length > 100) {
                                    // Extract meaningful portion (skip cookie/nav noise)
                                    const lines = text.split(/\.\s+/).filter(l => l.length > 20 && l.length < 500);
                                    if (lines.length > 2) {
                                        result.seaBulletin = lines.slice(0, 10).join('. ').substring(0, 1500);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    result.error = 'Bollettino ARPAL non raggiungibile: ' + e.message;
                }

                track('arpal');
                cacheSet(cacheKey, result, 30 * 60 * 1000); // 30 min cache
                res.json(result);
            }
        }
    ],
    healthCheck() { return true; }
};
