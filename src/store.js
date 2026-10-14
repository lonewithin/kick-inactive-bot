const fs = require('fs');
const path = require('path');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'store.json');
let db = { chats: {} };
let timer = null;

function load() {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!db.chats) db.chats = {}; }
  catch { db = { chats: {} }; }
}
function saveNow() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
function save() { if (!timer) timer = setTimeout(() => { timer = null; try { saveNow(); } catch (e) { console.error('save failed', e.message); } }, 2000); }

function chat(chatId) {
  const id = String(chatId);
  if (!db.chats[id]) { db.chats[id] = { addedAt: Date.now(), title: '', members: {}, exempt: {}, autokick: null }; save(); }
  return db.chats[id];
}
function touch(chatId, user, { joined = false } = {}) {
  if (!user) return;
  const c = chat(chatId);
  const now = Date.now();
  const m = c.members[user.id] || { id: user.id, joinedAt: null, lastActive: null };
  m.name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  m.username = user.username || null;
  m.isBot = !!user.is_bot;
  if (joined) m.joinedAt = now; else m.lastActive = now;
  m.left = false;
  c.members[user.id] = m;
  save();
}
function markLeft(chatId, userId) {
  const c = chat(chatId);
  if (c.members[userId]) { c.members[userId].left = true; save(); }
}
function lastSeen(c, m) { return m.lastActive || m.joinedAt || c.addedAt; }
function findByUsername(chatId, uname) {
  const u = uname.replace(/^@/, '').toLowerCase();
  return Object.values(chat(chatId).members).find(m => (m.username || '').toLowerCase() === u) || null;
}
function allChats() { return db.chats; }

load();
process.on('exit', () => { try { saveNow(); } catch {} });
module.exports = { chat, touch, markLeft, lastSeen, findByUsername, allChats, save, saveNow };
