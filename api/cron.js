// Vercel Cron (daily). Drains queued removals and runs weekly /autokick for chats that are due.
const { Api } = require('grammy');
const { runScheduled } = require('../src/bot');

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401; return res.end('unauthorized');
  }
  const report = await runScheduled(new Api(process.env.BOT_TOKEN), { budgetMs: 45000 });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, report }));
};
