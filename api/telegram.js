// Vercel serverless webhook: Telegram POSTs every update here.
const { webhookCallback } = require('grammy');
const { createBot } = require('../src/bot');

const bot = createBot(process.env.BOT_TOKEN);
const handle = webhookCallback(bot, 'http', {
  secretToken: process.env.WEBHOOK_SECRET,
  onTimeout: 'return',          // answer Telegram before Vercel's 60s cap; work continues until the function ends
  timeoutMilliseconds: 55000,
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 200; return res.end('ok'); }
  if (!process.env.WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
    res.statusCode = 401; return res.end('unauthorized');
  }
  return handle(req, res);
};
