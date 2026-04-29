# rssdoge

Cloudflare Worker that aggregates RSS/Atom feeds and posts them to Telegram with AI-generated summaries. Each post is summarized into 7 bullet points via Cloudflare Workers AI, which fits within the free tier.

## Example

Here is an example of a Telegram channel that provides security-related content that I find interesting: [t.me/secpaperboy](https://t.me/secpaperboy).

## How to use

1. Obtain the Telegram bot's token via [@BotFather](https://t.me/BotFather) bot.
2. Push secrets to Cloudflare:
   ```
   echo -ne $TELEGRAM_TOKEN | wrangler secret put TELEGRAM_TOKEN
   echo -ne $SENTRY_DSN | wrangler secret put SENTRY_DSN
   ```
3. Configure feeds, chat ID, and AI prompt in `src/config.js`.
4. Configure the cron schedule in `wrangler.toml`.
5. Deploy: `npm run deploy`.
