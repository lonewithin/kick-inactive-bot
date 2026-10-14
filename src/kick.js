const store = require('./store');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 86400000;

async function adminIds(api, chatId) {
  const admins = await api.getChatAdministrators(chatId);
  return new Set(admins.map(a => a.user.id));
}

async function findInactive(api, chatId, days) {
  const c = store.chat(chatId);
  const admins = await adminIds(api, chatId);
  const cutoff = Date.now() - days * DAY;
  return Object.values(c.members).filter(m =>
    !m.left && !m.isBot && !admins.has(m.id) && !c.exempt[m.id] &&
    store.lastSeen(c, m) <= cutoff);
}

async function kickList(api, chatId, list) {
  let kicked = 0; const failed = [];
  for (const m of list) {
    try {
      await api.banChatMember(chatId, m.id);
      await api.unbanChatMember(chatId, m.id, { only_if_banned: true });
      store.markLeft(chatId, m.id); kicked++;
    } catch (e) { failed.push(`${label(m)} (${e.description || e.message})`); }
    await sleep(1100);
  }
  return { kicked, failed };
}

function label(m) { return m.username ? '@' + m.username : (m.name || String(m.id)); }
function esc(s) { return String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])); }

module.exports = { findInactive, kickList, label, esc, DAY };
