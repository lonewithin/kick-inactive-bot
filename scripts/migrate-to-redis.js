// Copy data/store.json (box version) into Upstash Redis. Needs KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN.
const { redisEnv } = require('../src/kv');
if (!redisEnv()) { console.error('Set Redis env vars first'); process.exit(1); }
require('../src/legacy').importLegacy(process.argv[2], { force: true }).then(n => console.log(`Done: ${n} chat(s)`));
