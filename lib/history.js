const path = require('path');
const fs = require('fs');

const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');
fs.mkdirSync(HISTORY_DIR, { recursive: true });

const CACHE_TTL = 15 * 60 * 1000;

function todayStr() { return new Date().toISOString().split('T')[0]; }

function saveHistory(type, points, data) {
    try {
        const today = todayStr();
        const file = path.join(HISTORY_DIR, `${today}.json`);
        let history = [];
        if (fs.existsSync(file)) {
            try { history = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        }
        const lastOfType = history.filter(h => h.type === type).pop();
        if (lastOfType && Date.now() - new Date(lastOfType.ts).getTime() < CACHE_TTL) return;

        history.push({ ts: new Date().toISOString(), type, points, data });
        fs.writeFileSync(file, JSON.stringify(history));
    } catch (e) {
        console.warn('History save error:', e.message);
    }
}

module.exports = { saveHistory, HISTORY_DIR, todayStr };
