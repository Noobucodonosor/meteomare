const { todayStr } = require('./history');

let usage = { date: todayStr() };

function track(source) {
    if (usage.date !== todayStr()) {
        const keys = Object.keys(usage).filter(k => k !== 'date');
        usage = { date: todayStr() };
        keys.forEach(k => usage[k] = 0);
    }
    usage[source] = (usage[source] || 0) + 1;
}

function getUsage() { return usage; }

module.exports = { track, getUsage };
