# rssdoge

A simple Cloudflare worker that aggregates different RSS/ATOM feeds and forwards them to the Telegram.

## Example

Here is an example of a Telegram channel that provides security-related content that I find interesting: [t.me/owsecurity](https://t.me/owsecurity).

## How to use

1. Obtain the Telegram bot's token via [@BotFather](https://t.me/BotFather) bot.
2. Push the secret to the Cloudflare using `echo -ne $SECRET | wrangler secret put "TELEGRAM_TOKEN"`.
3. Configure the chat ID and list of RSS/ATOM feeds in `src/config.js`.
4. Configure the cron triggers in `wrangler.toml`.
5. Deploy the worker using `npm run deploy`.
