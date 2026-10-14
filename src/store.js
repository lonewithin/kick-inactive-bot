// Per-chat storage on top of kv.js.
// Keys:  kib:chats (set of chat ids)
//        kib:chat:<id>:meta    hash { addedAt, title, autokick(JSON|"") }
//        kib:chat:<id>:members hash { <userId>: JSON member }
//        kib:chat:<id>:exempt  hash { <userId>: "1" }
//        kib:chat:<id>:queue   list of user ids still to kick (continued by cron)
//        kib:pending:<key>     JSON confirm request (10 min TTL)
const kv = require('./kv');
const K = id => `kib:chat:${id}`;
const parse = v => (v == null || v === '' ? null : typeof v === 'string' ? JSON.parse(v) : v);

async function meta(chatId) {
  const db = kv(); const m = await db.hgetall(K(chatId) + ':meta');
  if (!m.addedAt) {
    const fresh = { addedAt: Date.now(), title: '', autokick: '' };
    await db.hset(K(chatId) + ':meta', fresh); await db.sadd('kib:chats', chatId);
    return { addedAt: fresh.addedAt, title: '', autokick: null };
  }
  return { addedAt: Number(m.addedAt), title: m.title || '', autokick: parse(m.autokick) };
}
async function setMeta(chatId, fields) {
  const o = { ...fields }; if ('autokick' in o) o.autokick = o.autokick ? JSON.stringify(o.autokick) : '';
  await kv().sadd('kib:chats', chatId); return kv().hset(K(chatId) + ':meta', o);
}
async function getMember(chatId, uid) { return parse(await kv().hget(K(chatId) + ':members', uid)); }
async function putMember(chatId, m) { return kv().hset(K(chatId) + ':members', { [m.id]: JSON.stringify(m) }); }
async function members(chatId) { return Object.values(await kv().hgetall(K(chatId) + ':members')).map(parse); }

async function touch(chatId, user, { joined = false } = {}) {
  if (!user) return;
  await meta(chatId);
  const m = (await getMember(chatId, user.id)) || { id: user.id, joinedAt: null, lastActive: null };
  m.name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  m.username = user.username || null; m.isBot = !!user.is_bot; m.left = false;
  if (joined) m.joinedAt = Date.now(); else m.lastActive = Date.now();
  return putMember(chatId, m);
}
async function markLeft(chatId, uid) { const m = await getMember(chatId, uid); if (m) { m.left = true; await putMember(chatId, m); } }
const lastSeen = (meta, m) => m.lastActive || m.joinedAt || meta.addedAt;
async function findByUsername(chatId, uname) {
  const u = uname.replace(/^@/, '').toLowerCase();
  return (await members(chatId)).find(m => (m.username || '').toLowerCase() === u) || null;
}
async function exempt(chatId) { return new Set(Object.keys(await kv().hgetall(K(chatId) + ':exempt'))); }
async function setExempt(chatId, uid, on) { return on ? kv().hset(K(chatId) + ':exempt', { [uid]: '1' }) : kv().hdel(K(chatId) + ':exempt', uid); }
async function chatIds() { return kv().smembers('kib:chats'); }

const setPending = (key, p) => kv().set('kib:pending:' + key, JSON.stringify(p), 600);
const getPending = async key => parse(await kv().get('kib:pending:' + key));
const delPending = key => kv().del('kib:pending:' + key);
const queuePush = (chatId, ids) => kv().rpush(K(chatId) + ':queue', ...ids.map(String));
const queuePop = async (chatId, n) => ((await kv().lpop(K(chatId) + ':queue', n)) || []).map(Number);
const queueLen = chatId => kv().llen(K(chatId) + ':queue');

module.exports = { meta, setMeta, getMember, putMember, members, touch, markLeft, lastSeen, findByUsername,
  exempt, setExempt, chatIds, setPending, getPending, delPending, queuePush, queuePop, queueLen };
