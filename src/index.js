// Local development: long polling + JSON file store (or Redis if its env vars are set).
try { require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^(\w+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }); } catch {}
const { createBot, runScheduled, COMMANDS, ALLOWED_UPDATES } = require('./bot');
const { importLegacy } = require('./legacy');

const token = process.env.TG_CLEANER_BOT_TOKEN || process.env.BOT_TOKEN;
if (!token) { console.error('Missing TG_CLEANER_BOT_TOKEN (or BOT_TOKEN) env var'); process.exit(1); }
const bot = createBot(token);

(async () => {
  await importLegacy();
  const me = await bot.api.getMe();
  console.log(`[${new Date().toISOString()}] getMe ok: @${me.username} (id ${me.id})`);
  await bot.api.setMyCommands(COMMANDS);
  setInterval(() => runScheduled(bot.api).catch(e => console.error('scheduled loop', e.message)), 10 * 60000);
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { bot.stop(); process.exit(0); });
  await bot.start({ allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false, onStart: () => console.log('Polling started') });
})().catch(e => { console.error('Fatal:', e.description || e.message); process.exit(1); });
