const store = require('./store');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 86400000;
// Stay well under Vercel's 60s function limit; leftovers go to the per-chat queue for the next cron run.
const BUDGET_MS = Number(process.env.KICK_BUDGET_MS || 45000);

async function findInactive(api, chatId, days) {
  const [meta, list, ex, admins] = await Promise.all([store.meta(chatId), store.members(chatId), store.exempt(chatId), api.getChatAdministrators(chatId)]);
  const adminIds = new Set(admins.map(a => a.user.id));
  const cutoff = Date.now() - days * DAY;
  return list.filter(m => !m.left && !m.isBot && !adminIds.has(m.id) && !ex.has(String(m.id)) && store.lastSeen(meta, m) <= cutoff);
}

// Kicks as many as fit in the time budget. Returns leftovers (not attempted).
async function kickList(api, chatId, list, { deadline = Date.now() + BUDGET_MS } = {}) {
  let kicked = 0; const failed = []; let i = 0;
  for (; i < list.length; i++) {
    if (Date.now() > deadline) break;
    const m = list[i];
    try {
      await api.banChatMember(chatId, m.id);
      await api.unbanChatMember(chatId, m.id, { only_if_banned: true });
      await store.markLeft(chatId, m.id); kicked++;
    } catch (e) { failed.push(`${label(m)} (${e.description || e.message})`); }
    if (i < list.length - 1) await sleep(1100);
  }
  return { kicked, failed, rest: list.slice(i) };
}

// Kick, and queue whatever didn't fit for the next cron.
async function kickOrQueue(api, chatId, list, opts) {
  const r = await kickList(api, chatId, list, opts);
  if (r.rest.length) await store.queuePush(chatId, r.rest.map(m => m.id));
  return r;
}

function label(m) { return m.username ? '@' + m.username : (m.name || String(m.id)); }
function esc(s) { return String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])); }

module.exports = { findInactive, kickList, kickOrQueue, label, esc, DAY, BUDGET_MS };
