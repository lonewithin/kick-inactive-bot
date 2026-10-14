# Kick Inactive Bot (@Akickinactivebot)

A Telegram bot that tracks who is active in your group and helps admins remove inactive members. Built with Node.js + [grammY](https://grammy.dev), long polling, JSON storage.

## How it works
- Records each member's last message, join and leave (`message` + `chat_member` updates).
- Telegram doesn't give bots old history or the full member list, so it only knows activity **since it was added**. Members never seen count from their join time or from when the bot was added.
- Removal = ban + immediate unban, so people can rejoin with an invite link.
- Admins, the owner, bots and exempt users are never removed.

## Setup in a group
1. Add @Akickinactivebot to the group.
2. Promote it to **admin** with **Ban users** permission.

## Commands (admins only)
| Command | What it does |
|---|---|
| `/start`, `/help` | Setup info |
| `/inactive <days>` | List members silent ≥ days (default 14) |
| `/kick_inactive <days>` | Shows count with Confirm/Cancel, then removes (~1/sec) and reports |
| `/exempt` | Reply to a user or `/exempt @username` to whitelist |
| `/unexempt` | Remove from whitelist |
| `/stats` | Tracked members, active in last 7 days |
| `/autokick <days\|off>` | Weekly automatic cleanup with a summary post |

## Run
```bash
npm install
cp .env.example .env   # or export TG_CLEANER_BOT_TOKEN=...
export TG_CLEANER_BOT_TOKEN=your_token
npm start
```
Data is stored in `data/store.json` (override with `DATA_FILE`).

## Serverless on Vercel (free Hobby)
- `api/telegram.js` – webhook (grammY `webhookCallback`), checks `X-Telegram-Bot-Api-Secret-Token` against `WEBHOOK_SECRET`.
- `api/cron.js` – daily Vercel Cron (`0 3 * * *`, see `vercel.json`), protected by `CRON_SECRET`. Runs weekly `/autokick` per chat and continues kick batches that didn't fit (each invocation stays under ~45s of kicking, well inside the 60s limit).
- Storage: Upstash Redis (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`), per-chat hashes `kib:chat:<id>:meta|members|exempt`. Without those vars (local dev) it uses `data/kv.json`.

Env vars: `BOT_TOKEN`, `WEBHOOK_SECRET`, `CRON_SECRET`, plus the Redis vars (added automatically when you connect Upstash from Vercel → Storage).

Switch-over:
```bash
npm run migrate-to-redis                 # copy box data (needs Redis env vars)
BOT_TOKEN=... WEBHOOK_SECRET=... npm run set-webhook -- https://<project>.vercel.app/api/telegram
```
Stop the local polling bot after setting the webhook. `npm run set-webhook -- --delete` goes back to polling.
