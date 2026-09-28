# rssdoge

TypeScript Cloudflare Worker that turns RSS feeds into a sparse Telegram digest. Workers AI applies a strict editorial gate, stores good candidates, ranks them as a batch, and summarizes only the winners. Empty editions are allowed; filtered or failed items are never sent as bare links. arXiv is a weekly candidate source rather than a trusted feed, while HN and Lobsters add discovery outside the fixed allowlist.

## Example

My Telegram channel with security-related content: [t.me/secpaperboy](https://t.me/secpaperboy), running this worker.

## How to use

1. Obtain the Telegram bot's token via [@BotFather](https://t.me/BotFather) bot.
2. Push secrets to Cloudflare:
   ```
   echo -ne $TELEGRAM_TOKEN | wrangler secret put TELEGRAM_TOKEN
   echo -ne $SENTRY_DSN | wrangler secret put SENTRY_DSN
   ```
3. Configure feeds, chat ID, models, and limits in `src/config.ts`; edit editorial prompts in `src/prompts.ts`.
4. Configure the cron schedule in `wrangler.toml`.
5. Deploy: `npm run deploy`.
