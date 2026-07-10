# rssdoge

TypeScript Cloudflare Worker: one Telegram digest from your RSS feeds instead of dozens of tabs. Workers AI skips ads and fluff, then summarizes the rest into short bullets — language, tone, and focus come from prompts in `src/config.ts`. Research sources (e.g. arXiv) use a separate know-how style; optional full-text enrichment via `AI.toMarkdown()`. Cron in `wrangler.toml`; default setup fits Cloudflare's free tier.

## Example

My Telegram channel with security-related content: [t.me/secpaperboy](https://t.me/secpaperboy), running this worker.

## How to use

1. Obtain the Telegram bot's token via [@BotFather](https://t.me/BotFather) bot.
2. Push secrets to Cloudflare:
   ```
   echo -ne $TELEGRAM_TOKEN | wrangler secret put TELEGRAM_TOKEN
   echo -ne $SENTRY_DSN | wrangler secret put SENTRY_DSN
   ```
3. Configure feeds, chat ID, models, and prompts in `src/config.ts`.
4. Configure the cron schedule in `wrangler.toml`.
5. Deploy: `npm run deploy`.
