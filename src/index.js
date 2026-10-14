const { Bot, InlineKeyboard, GrammyError, HttpError } = require('grammy');
const store = require('./store');
const { findInactive, kickList, label, esc, DAY } = require('./kick');

const token = process.env.TG_CLEANER_BOT_TOKEN;
if (!token) { console.error('Missing TG_CLEANER_BOT_TOKEN env var'); process.exit(1); }
const bot = new Bot(token);
const pending = new Map(); // key -> {chatId, days, ids, by, exp}

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

const isGroup = ctx => ['group', 'supergroup'].includes(ctx.chat?.type);
async function isAdmin(ctx) {
  try { const m = await ctx.getChatMember(ctx.from.id); return ['administrator', 'creator'].includes(m.status); }
  catch { return false; }
}
function parseDays(arg, def = 14) {
  const n = parseInt(String(arg || '').trim(), 10);
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : def;
}
const reply = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

// Track activity for every update first
bot.use(async (ctx, next) => {
  if (isGroup(ctx)) {
    const c = store.chat(ctx.chat.id); if (ctx.chat.title) c.title = ctx.chat.title;
    if (ctx.message?.new_chat_members) ctx.message.new_chat_members.forEach(u => store.touch(ctx.chat.id, u, { joined: true }));
    if (ctx.message?.left_chat_member) store.markLeft(ctx.chat.id, ctx.message.left_chat_member.id);
    else if (ctx.message && ctx.from && !ctx.message.new_chat_members) store.touch(ctx.chat.id, ctx.from);
  }
  return next();
});

bot.on('chat_member', ctx => {
  const u = ctx.chatMember.new_chat_member; const was = ctx.chatMember.old_chat_member.status;
  const inNow = ['member', 'administrator', 'creator', 'restricted'].includes(u.status) && (u.status !== 'restricted' || u.is_member);
  const inBefore = ['member', 'administrator', 'creator'].includes(was) || (was === 'restricted' && ctx.chatMember.old_chat_member.is_member);
  if (inNow && !inBefore) store.touch(ctx.chat.id, u.user, { joined: true });
  else if (!inNow && inBefore) store.markLeft(ctx.chat.id, u.user.id);
});

bot.on('my_chat_member', ctx => {
  const st = ctx.myChatMember.new_chat_member.status;
  if (['member', 'administrator'].includes(st) && isGroup(ctx)) {
    const c = store.chat(ctx.chat.id);
    if (!['member', 'administrator'].includes(ctx.myChatMember.old_chat_member.status)) { c.addedAt = Date.now(); store.save(); }
  }
});

bot.command(['start', 'help'], ctx => reply(ctx, HELP));

// Admin gate for group commands
const adminCmd = (name, fn) => bot.command(name, async ctx => {
  if (!isGroup(ctx)) return reply(ctx, 'Use this command inside a group where I\'m admin. Send /help for setup.');
  if (!(await isAdmin(ctx))) return reply(ctx, 'Sorry, only group admins can use that command 🙏');
  try { await fn(ctx); } catch (e) { console.error(name, e.description || e.message); await reply(ctx, '⚠️ Something went wrong: ' + esc(e.description || e.message)).catch(() => {}); }
});

adminCmd('inactive', async ctx => {
  const days = parseDays(ctx.match);
  const list = await findInactive(ctx.api, ctx.chat.id, days);
  if (!list.length) return reply(ctx, `✅ No tracked members silent for ${days}+ days.`);
  const c = store.chat(ctx.chat.id);
  const lines = list.slice(0, 100).map(m => `• ${esc(label(m))} – ${Math.floor((Date.now() - store.lastSeen(c, m)) / DAY)}d`);
  return reply(ctx, `😴 <b>${list.length}</b> member(s) silent for ${days}+ days:\n${lines.join('\n')}${list.length > 100 ? `\n…and ${list.length - 100} more` : ''}`);
});

adminCmd('kick_inactive', async ctx => {
  const days = parseDays(ctx.match);
  const list = await findInactive(ctx.api, ctx.chat.id, days);
  if (!list.length) return reply(ctx, `✅ Nobody to remove (silent ${days}+ days).`);
  const key = Math.random().toString(36).slice(2, 10);
  pending.set(key, { chatId: ctx.chat.id, days, ids: list.map(m => m.id), by: ctx.from.id, exp: Date.now() + 10 * 60000 });
  const kb = new InlineKeyboard().text(`✅ Confirm (${list.length})`, `kc:${key}`).text('❌ Cancel', `kx:${key}`);
  return reply(ctx, `⚠️ Remove <b>${list.length}</b> member(s) silent for ${days}+ days? They can rejoin with an invite link.`, { reply_markup: kb });
});

bot.callbackQuery(/^k([cx]):(\w+)$/, async ctx => {
  const [, act, key] = ctx.match; const p = pending.get(key);
  if (!p || p.exp < Date.now()) { pending.delete(key); await ctx.answerCallbackQuery({ text: 'This request expired. Run /kick_inactive again.' }); return ctx.editMessageReplyMarkup().catch(() => {}); }
  if (!(await isAdmin(ctx))) return ctx.answerCallbackQuery({ text: 'Only admins can do that.', show_alert: true });
  pending.delete(key);
  if (act === 'x') { await ctx.answerCallbackQuery({ text: 'Cancelled' }); return ctx.editMessageText('❌ Cancelled. Nobody was removed.'); }
  await ctx.answerCallbackQuery({ text: 'Removing…' });
  await ctx.editMessageText(`⏳ Removing ${p.ids.length} member(s)…`);
  // re-check against current state (they may have spoken since)
  const fresh = (await findInactive(ctx.api, p.chatId, p.days)).filter(m => p.ids.includes(m.id));
  const { kicked, failed } = await kickList(ctx.api, p.chatId, fresh);
  const msg = `🧹 Done. Removed <b>${kicked}</b>${failed.length ? `, failed <b>${failed.length}</b>:\n${failed.slice(0, 30).map(f => '• ' + esc(f)).join('\n')}` : '.'}`;
  return ctx.editMessageText(msg, { parse_mode: 'HTML' }).catch(() => reply(ctx, msg));
});

async function targetFrom(ctx) {
  const r = ctx.message.reply_to_message?.from;
  if (r) { store.touch(ctx.chat.id, r, { joined: false }); return { id: r.id, label: label({ username: r.username, name: r.first_name, id: r.id }) }; }
  const arg = (ctx.match || '').trim();
  if (arg.startsWith('@')) { const m = store.findByUsername(ctx.chat.id, arg); if (m) return { id: m.id, label: label(m) }; }
  if (/^\d+$/.test(arg)) return { id: Number(arg), label: arg };
  return null;
}
adminCmd('exempt', async ctx => {
  const t = await targetFrom(ctx);
  if (!t) return reply(ctx, 'Reply to a member\'s message with /exempt, or use /exempt @username (I must have seen them in this group).');
  store.chat(ctx.chat.id).exempt[t.id] = true; store.save();
  return reply(ctx, `🛡️ ${esc(t.label)} is exempt and will never be removed.`);
});
adminCmd('unexempt', async ctx => {
  const t = await targetFrom(ctx);
  if (!t) return reply(ctx, 'Reply to a member\'s message with /unexempt, or use /unexempt @username.');
  delete store.chat(ctx.chat.id).exempt[t.id]; store.save();
  return reply(ctx, `${esc(t.label)} is no longer exempt.`);
});
adminCmd('stats', async ctx => {
  const c = store.chat(ctx.chat.id);
  const ms = Object.values(c.members).filter(m => !m.left && !m.isBot);
  const wk = ms.filter(m => m.lastActive && m.lastActive >= Date.now() - 7 * DAY).length;
  let total = '?'; try { total = await ctx.api.getChatMemberCount(ctx.chat.id); } catch {}
  return reply(ctx, `📊 <b>Stats</b>\nGroup members: ${total}\nTracked: ${ms.length}\nActive last 7 days: ${wk}\nExempt: ${Object.keys(c.exempt).length}\nTracking since: ${new Date(c.addedAt).toUTCString()}\nAutokick: ${c.autokick ? `every week, ${c.autokick.days}+ days` : 'off'}`);
});
adminCmd('autokick', async ctx => {
  const c = store.chat(ctx.chat.id); const arg = (ctx.match || '').trim().toLowerCase();
  if (arg === 'off') { c.autokick = null; store.save(); return reply(ctx, '⏹️ Weekly autokick is off.'); }
  if (!arg) return reply(ctx, `Autokick is ${c.autokick ? `on (${c.autokick.days}+ days)` : 'off'}. Use /autokick 30 or /autokick off.`);
  const days = parseDays(arg, NaN); if (!Number.isFinite(days)) return reply(ctx, 'Usage: /autokick &lt;days&gt; or /autokick off');
  c.autokick = { days, next: Date.now() + 7 * DAY }; store.save();
  return reply(ctx, `⏰ Weekly autokick on: members silent ${days}+ days are removed every 7 days. First run: ${new Date(c.autokick.next).toUTCString()}.`);
});

// Weekly scheduler
async function runAutokick() {
  for (const [chatId, c] of Object.entries(store.allChats())) {
    if (!c.autokick || c.autokick.next > Date.now()) continue;
    c.autokick.next = Date.now() + 7 * DAY; store.save();
    try {
      const list = await findInactive(bot.api, chatId, c.autokick.days);
      const { kicked, failed } = await kickList(bot.api, chatId, list);
      await bot.api.sendMessage(chatId, `🤖 Weekly cleanup: removed ${kicked} member(s) silent ${c.autokick.days}+ days${failed.length ? `, ${failed.length} failed` : ''}.`);
    } catch (e) { console.error('autokick', chatId, e.description || e.message); }
  }
}
setInterval(() => runAutokick().catch(e => console.error('autokick loop', e.message)), 10 * 60000);

bot.catch(err => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('Telegram error:', e.description);
  else if (e instanceof HttpError) console.error('Network error:', e.message);
  else console.error('Error:', e?.message || e);
});

const cmds = [
  ['start', 'How to set me up'], ['help', 'Help and commands'],
  ['inactive', 'List inactive members: /inactive 14'], ['kick_inactive', 'Remove inactive members: /kick_inactive 14'],
  ['exempt', 'Protect a member (reply or @username)'], ['unexempt', 'Remove protection'],
  ['stats', 'Activity stats'], ['autokick', 'Weekly cleanup: /autokick 30 | off'],
].map(([command, description]) => ({ command, description }));

(async () => {
  const me = await bot.api.getMe();
  console.log(`[${new Date().toISOString()}] getMe ok: @${me.username} (id ${me.id})`);
  await bot.api.setMyCommands(cmds);
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { store.saveNow(); bot.stop(); process.exit(0); });
  await bot.start({ allowed_updates: ['message', 'chat_member', 'my_chat_member', 'callback_query'], drop_pending_updates: false,
    onStart: () => console.log('Polling started') });
})().catch(e => { console.error('Fatal:', e.description || e.message); process.exit(1); });
