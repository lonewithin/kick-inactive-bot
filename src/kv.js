// Tiny KV adapter: Upstash Redis on Vercel (or whenever its env vars are set), JSON file locally.
const fs = require('fs');
const path = require('path');

function redisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function redisKV() {
  const { Redis } = require('@upstash/redis');
  const r = new Redis({ ...redisEnv(), automaticDeserialization: false });
  return {
    kind: 'redis',
    hget: (k, f) => r.hget(k, String(f)),
    hgetall: async k => (await r.hgetall(k)) || {},
    hset: (k, obj) => r.hset(k, obj),
    hdel: (k, f) => r.hdel(k, String(f)),
    sadd: (k, v) => r.sadd(k, String(v)),
    smembers: k => r.smembers(k),
    get: k => r.get(k),
    set: (k, v, ex) => (ex ? r.set(k, v, { ex }) : r.set(k, v)),
    del: k => r.del(k),
    rpush: (k, ...v) => (v.length ? r.rpush(k, ...v) : 0),
    lpop: (k, n) => r.lpop(k, n),
    llen: k => r.llen(k),
  };
}

function fileKV() {
  const FILE = process.env.KV_FILE || path.join(__dirname, '..', 'data', 'kv.json');
  let d = {};
  try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  let t = null;
  const flush = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(d)); fs.renameSync(FILE + '.tmp', FILE); };
  const save = () => { if (!t) t = setTimeout(() => { t = null; try { flush(); } catch (e) { console.error('kv save', e.message); } }, 1000); };
  process.on('exit', () => { try { flush(); } catch {} });
  const obj = k => (d[k] ||= {});
  const exp = {};
  const live = k => { if (exp[k] && exp[k] < Date.now()) { delete d[k]; delete exp[k]; } return d[k]; };
  return {
    kind: 'file', flush, isEmpty: () => !Object.keys(d).length,
    hget: async (k, f) => obj(k)[f] ?? null,
    hgetall: async k => ({ ...(d[k] || {}) }),
    hset: async (k, o) => { Object.assign(obj(k), Object.fromEntries(Object.entries(o).map(([a, b]) => [a, String(b)]))); save(); },
    hdel: async (k, f) => { if (d[k]) delete d[k][f]; save(); },
    sadd: async (k, v) => { const s = new Set(d[k] || []); s.add(String(v)); d[k] = [...s]; save(); },
    smembers: async k => [...(d[k] || [])],
    get: async k => live(k) ?? null,
    set: async (k, v, ex) => { d[k] = v; if (ex) exp[k] = Date.now() + ex * 1000; save(); },
    del: async k => { delete d[k]; save(); },
    rpush: async (k, ...v) => { (d[k] ||= []).push(...v.map(String)); save(); },
    lpop: async (k, n) => { const a = d[k] || []; const out = a.splice(0, n); save(); return out; },
    llen: async k => (d[k] || []).length,
  };
}

let inst;
module.exports = () => (inst ||= redisEnv() ? redisKV() : fileKV());
module.exports.redisEnv = redisEnv;
