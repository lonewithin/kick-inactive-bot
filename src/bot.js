const { Bot, InlineKeyboard, GrammyError, HttpError } = require('grammy');
const store = require('./store');
const { findInactive, kickOrQueue, label, esc, DAY } = require('./kick');

const HELP = `👋 <b>Kick Inactive Bot</b>
I track who talks in this group and help admins remove inactive members.

<b>Setup</b>
1. Add me to the group.
2. Make me an <b>admin</b> with the <b>Ban users</b> permission (as admin I see all messages, so privacy mode doesn't matter).

<b>Important:</b> Telegram doesn't let bots see old history or the full member list, so I only know about activity <i>since I was added</i>. Members I've never seen count from when they joined or when I was added.

<b>Admin commands</b>
/inactive &lt;days&gt; – list members silent for that many days (default 14)
/kick_inactive &lt;days&gt; – remove them (asks to confirm; they can rejoin)
/exempt – reply to someone or give @username to protect them
/unexempt – remove protection
/stats – tracked members and activity
/autokick &lt;days|off&gt; – weekly automatic cleanup

Admins, bots and the owner are never removed.`;

const COMMANDS = [
  ['start', 'How to set me up'], ['help', 'Help and commands'],
  ['inactive', 'List inactive members: /inactive 14'], ['kick_inactive', 'Remove inactive members: /kick_inactive 14'],
  ['exempt', 'Protect a member (reply or @username)'], ['unexempt', 'Remove protection'],
  ['stats', 'Activity stats'], ['autokick', 'Weekly cleanup: /autokick 30 | off'],
].map(([command, description]) => ({ command, description }));
const ALLOWED_UPDATES = ['message', 'chat_member', 'my_chat_member', 'callback_query'];

const isGroup = ctx => ['group', 'supergroup'].includes(ctx.chat?.type);
async function isAdmin(ctx) {
  try { const m = await ctx.getChatMember(ctx.from.id); return ['administrator', 'creator'].includes(m.status); } catch { return false; }
}
function parseDays(arg, def = 14) {
  const n = parseInt(String(arg || '').trim(), 10);
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : def;
}
const reply = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

function createBot(token) {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (isGroup(ctx)) {
      const id = ctx.chat.id; const meta = await store.meta(id);
      if (ctx.chat.title && ctx.chat.title !== meta.title) await store.setMeta(id, { title: ctx.chat.title });
      const msg = ctx.message;
      if (msg?.new_chat_members) for (const u of msg.new_chat_members) await store.touch(id, u, { joined: true });
      if (msg?.left_chat_member) await store.markLeft(id, msg.left_chat_member.id);
      else if (msg && ctx.from && !msg.new_chat_members) await store.touch(id, ctx.from);
    }
    return next();
  });

  bot.on('chat_member', async ctx => {
    const u = ctx.chatMember.new_chat_member; const old = ctx.chatMember.old_chat_member;
    const inNow = ['member', 'administrator', 'creator'].includes(u.status) || (u.status === 'restricted' && u.is_member);
    const inBefore = ['member', 'administrator', 'creator'].includes(old.status) || (old.status === 'restricted' && old.is_member);
    if (inNow && !inBefore) await store.touch(ctx.chat.id, u.user, { joined: true });
    else if (!inNow && inBefore) await store.markLeft(ctx.chat.id, u.user.id);
  });

  bot.on('my_chat_member', async ctx => {
    const st = ctx.myChatMember.new_chat_member.status;
    if (['member', 'administrator'].includes(st) && isGroup(ctx) && !['member', 'administrator'].includes(ctx.myChatMember.old_chat_member.status))
      await store.setMeta(ctx.chat.id, { addedAt: Date.now() });
  });

  bot.command(['start', 'help'], ctx => reply(ctx, HELP));

  const adminCmd = (name, fn) => bot.command(name, async ctx => {
    if (!isGroup(ctx)) return reply(ctx, 'Use this command inside a group where I\'m admin. Send /help for setup.');
    if (!(await isAdmin(ctx))) return reply(ctx, 'Sorry, only group admins can use that command 🙏');
    try { await fn(ctx); } catch (e) { console.error(name, e.description || e.message); await reply(ctx, '⚠️ Something went wrong: ' + esc(e.description || e.message)).catch(() => {}); }
  });

  adminCmd('inactive', async ctx => {
    const days = parseDays(ctx.match);
    const list = await findInactive(ctx.api, ctx.chat.id, days);
    if (!list.length) return reply(ctx, `✅ No tracked members silent for ${days}+ days.`);
    const meta = await store.meta(ctx.chat.id);
    const lines = list.slice(0, 100).map(m => `• ${esc(label(m))} – ${Math.floor((Date.now() - store.lastSeen(meta, m)) / DAY)}d`);
    return reply(ctx, `😴 <b>${list.length}</b> member(s) silent for ${days}+ days:\n${lines.join('\n')}${list.length > 100 ? `\n…and ${list.length - 100} more` : ''}`);
  });

  adminCmd('kick_inactive', async ctx => {
    const days = parseDays(ctx.match);
    const list = await findInactive(ctx.api, ctx.chat.id, days);
    if (!list.length) return reply(ctx, `✅ Nobody to remove (silent ${days}+ days).`);
    const key = Math.random().toString(36).slice(2, 10);
    await store.setPending(key, { chatId: ctx.chat.id, days, ids: list.map(m => m.id), by: ctx.from.id });
    const kb = new InlineKeyboard().text(`✅ Confirm (${list.length})`, `kc:${key}`).text('❌ Cancel', `kx:${key}`);
    return reply(ctx, `⚠️ Remove <b>${list.length}</b> member(s) silent for ${days}+ days? They can rejoin with an invite link.`, { reply_markup: kb });
  });

  bot.callbackQuery(/^k([cx]):(\w+)$/, async ctx => {
    const [, act, key] = ctx.match; const p = await store.getPending(key);
    if (!p) { await ctx.answerCallbackQuery({ text: 'This request expired. Run /kick_inactive again.' }); return ctx.editMessageReplyMarkup().catch(() => {}); }
    if (!(await isAdmin(ctx))) return ctx.answerCallbackQuery({ text: 'Only admins can do that.', show_alert: true });
    await store.delPending(key);
    if (act === 'x') { await ctx.answerCallbackQuery({ text: 'Cancelled' }); return ctx.editMessageText('❌ Cancelled. Nobody was removed.'); }
    await ctx.answerCallbackQuery({ text: 'Removing…' });
    await ctx.editMessageText(`⏳ Removing ${p.ids.length} member(s)…`);
    const fresh = (await findInactive(ctx.api, p.chatId, p.days)).filter(m => p.ids.includes(m.id));
    await store.setMeta(p.chatId, { queueDays: p.days });
    const { kicked, failed, rest } = await kickOrQueue(ctx.api, p.chatId, fresh);
    let msg = `🧹 Done. Removed <b>${kicked}</b>${failed.length ? `, failed <b>${failed.length}</b>:\n${failed.slice(0, 30).map(f => '• ' + esc(f)).join('\n')}` : '.'}`;
    if (rest.length) msg += `\n⏭️ <b>${rest.length}</b> more queued; they'll be removed in the next scheduled run (daily).`;
    return ctx.editMessageText(msg, { parse_mode: 'HTML' }).catch(() => reply(ctx, msg));
  });

  async function targetFrom(ctx) {
    const r = ctx.message.reply_to_message?.from;
    if (r) { await store.touch(ctx.chat.id, r); return { id: r.id, label: label({ username: r.username, name: r.first_name, id: r.id }) }; }
    const arg = (ctx.match || '').trim();
    if (arg.startsWith('@')) { const m = await store.findByUsername(ctx.chat.id, arg); if (m) return { id: m.id, label: label(m) }; }
    if (/^\d+$/.test(arg)) return { id: Number(arg), label: arg };
    return null;
  }
  adminCmd('exempt', async ctx => {
    const t = await targetFrom(ctx);
    if (!t) return reply(ctx, 'Reply to a member\'s message with /exempt, or use /exempt @username (I must have seen them in this group).');
    await store.setExempt(ctx.chat.id, t.id, true);
    return reply(ctx, `🛡️ ${esc(t.label)} is exempt and will never be removed.`);
  });
  adminCmd('unexempt', async ctx => {
    const t = await targetFrom(ctx);
    if (!t) return reply(ctx, 'Reply to a member\'s message with /unexempt, or use /unexempt @username.');
    await store.setExempt(ctx.chat.id, t.id, false);
    return reply(ctx, `${esc(t.label)} is no longer exempt.`);
  });
  adminCmd('stats', async ctx => {
    const id = ctx.chat.id;
    const [meta, list, ex, q] = await Promise.all([store.meta(id), store.members(id), store.exempt(id), store.queueLen(id)]);
    const ms = list.filter(m => !m.left && !m.isBot);
    const wk = ms.filter(m => m.lastActive && m.lastActive >= Date.now() - 7 * DAY).length;
    let total = '?'; try { total = await ctx.api.getChatMemberCount(id); } catch {}
    return reply(ctx, `📊 <b>Stats</b>\nGroup members: ${total}\nTracked: ${ms.length}\nActive last 7 days: ${wk}\nExempt: ${ex.size}\nTracking since: ${new Date(meta.addedAt).toUTCString()}\nAutokick: ${meta.autokick ? `every week, ${meta.autokick.days}+ days` : 'off'}${q ? `\nQueued removals: ${q}` : ''}`);
  });
  adminCmd('autokick', async ctx => {
    const id = ctx.chat.id; const arg = (ctx.match || '').trim().toLowerCase();
    if (arg === 'off') { await store.setMeta(id, { autokick: null }); return reply(ctx, '⏹️ Weekly autokick is off.'); }
    const meta = await store.meta(id);
    if (!arg) return reply(ctx, `Autokick is ${meta.autokick ? `on (${meta.autokick.days}+ days)` : 'off'}. Use /autokick 30 or /autokick off.`);
    const days = parseDays(arg, NaN); if (!Number.isFinite(days)) return reply(ctx, 'Usage: /autokick &lt;days&gt; or /autokick off');
    const autokick = { days, next: Date.now() + 7 * DAY };
    await store.setMeta(id, { autokick });
    return reply(ctx, `⏰ Weekly autokick on: members silent ${days}+ days are removed every 7 days (checked daily). First run: ${new Date(autokick.next).toUTCString()}.`);
  });

  bot.catch(err => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('Telegram error:', e.description);
    else if (e instanceof HttpError) console.error('Network error:', e.message);
    else console.error('Error:', e?.message || e);
  });
  return bot;
}

// Scheduled work: drain queued removals, then run weekly autokick for chats that are due.
// Shares one time budget so a single invocation stays under 60s; anything left waits for the next run.
async function runScheduled(api, { budgetMs = Number(process.env.KICK_BUDGET_MS || 45000) } = {}) {
  const deadline = Date.now() + budgetMs; const report = [];
  for (const chatId of await store.chatIds()) {
    if (Date.now() > deadline) { report.push({ chatId, skipped: 'out of time' }); continue; }
    try {
      const meta = await store.meta(chatId);
      let kicked = 0, failed = 0, queued = 0;
      // 1) continue earlier batches
      if (await store.queueLen(chatId)) {
        const ids = new Set(await store.queuePop(chatId, 1000));
        const list = (await findInactive(api, chatId, meta.queueDays || meta.autokick?.days || 14)).filter(m => ids.has(m.id));
        const r = await kickOrQueue(api, chatId, list, { deadline });
        kicked += r.kicked; failed += r.failed.length; queued += r.rest.length;
      }
      // 2) weekly autokick
      if (meta.autokick && meta.autokick.next <= Date.now() && Date.now() < deadline) {
        await store.setMeta(chatId, { autokick: { ...meta.autokick, next: Date.now() + 7 * DAY }, queueDays: meta.autokick.days });
        const list = await findInactive(api, chatId, meta.autokick.days);
        const r = await kickOrQueue(api, chatId, list, { deadline });
        kicked += r.kicked; failed += r.failed.length; queued += r.rest.length;
        await api.sendMessage(chatId, `🤖 Weekly cleanup: removed ${r.kicked} member(s) silent ${meta.autokick.days}+ days${r.failed.length ? `, ${r.failed.length} failed` : ''}${r.rest.length ? `, ${r.rest.length} queued for the next run` : ''}.`).catch(() => {});
      }
      report.push({ chatId, kicked, failed, queued });
    } catch (e) { console.error('scheduled', chatId, e.description || e.message); report.push({ chatId, error: e.description || e.message }); }
  }
  return report;
}

module.exports = { createBot, runScheduled, COMMANDS, ALLOWED_UPDATES };
