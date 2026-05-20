const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    const ttl = entry.ttl || CACHE_TTL;
    if (Date.now() - entry.ts > ttl) { cache.delete(key); return null; }
    return entry.data;
}

function cacheSet(key, data, ttl) {
    cache.set(key, { ts: Date.now(), data, ...(ttl && { ttl }) });
}

module.exports = { cacheGet, cacheSet, cache, CACHE_TTL };
