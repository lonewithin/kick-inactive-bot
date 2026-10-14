// Usage: BOT_TOKEN=... WEBHOOK_SECRET=... node scripts/set-webhook.js https://<project>.vercel.app/api/telegram
//        node scripts/set-webhook.js --info   |   node scripts/set-webhook.js --delete  (back to long polling)
const { Api } = require('grammy');
const { COMMANDS, ALLOWED_UPDATES } = require('../src/bot');
const token = process.env.BOT_TOKEN || process.env.TG_CLEANER_BOT_TOKEN;
if (!token) { console.error('Set BOT_TOKEN'); process.exit(1); }
const api = new Api(token); const arg = process.argv[2];
(async () => {
  if (arg === '--info') return console.log(await api.getWebhookInfo());
  if (arg === '--delete') { await api.deleteWebhook({ drop_pending_updates: false }); return console.log('Webhook deleted'); }
  if (!arg || !/^https:\/\//.test(arg)) { console.error('Pass the https webhook URL'); process.exit(1); }
  if (!process.env.WEBHOOK_SECRET) { console.error('Set WEBHOOK_SECRET'); process.exit(1); }
  await api.setWebhook(arg, { secret_token: process.env.WEBHOOK_SECRET, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false });
  await api.setMyCommands(COMMANDS);
  console.log('Webhook set:', await api.getWebhookInfo());
})().catch(e => { console.error(e.description || e.message); process.exit(1); });
