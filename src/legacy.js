// One-time import of the old data/store.json format into the KV store (file or Redis).
const fs = require('fs'); const path = require('path');
const kv = require('./kv'); const store = require('./store');
async function importLegacy(file = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'store.json'), { force = false } = {}) {
  let db; try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  if (!force && await kv().get('kib:legacy_imported')) return 0;
  let n = 0;
  for (const [id, c] of Object.entries(db.chats || {})) {
    await store.setMeta(id, { addedAt: c.addedAt || Date.now(), title: c.title || '', autokick: c.autokick || null });
    for (const m of Object.values(c.members || {})) await store.putMember(id, m);
    for (const uid of Object.keys(c.exempt || {})) await store.setExempt(id, uid, true);
    n++;
  }
  await kv().set('kib:legacy_imported', String(Date.now()));
  if (n) console.log(`Imported ${n} chat(s) from ${file}`);
  return n;
}
module.exports = { importLegacy };
