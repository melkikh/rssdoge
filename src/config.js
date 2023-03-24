export const config = {
  production: {
    telegramToken: TELEGRAM_TOKEN,
    telegramChatID: "@owsecurity",
    feeds: {
      netsec: "https://reddit.com/r/netsec.rss",
      opennet: "https://www.opennet.ru/opennews/opennews_sec.rss",
      engineering_meta: "https://engineering.fb.com/feed/",
      googleonlinesecurity: "http://feeds.feedburner.com/GoogleOnlineSecurityBlog",
      googleprojectzero: "https://googleprojectzero.blogspot.com/feeds/posts/default",
      rapid7: "https://blog.rapid7.com/rss/",
      stackexchange_appsec: "https://security.stackexchange.com/feeds/tag/appsec",
      tavis_ormandy: "http://blog.cmpxchg8b.com/feeds/posts/default",
      brycx: "https://brycx.github.io/feed.xml",
      tailscale: "https://tailscale.com/blog/index.xml",
      datadog_security: "https://securitylabs.datadoghq.com/rss/feed.xml",
      patryk_kosieradzki: "https://patrykkosieradzki.medium.com/feed"
    },
  },
  development: {
    telegramToken: TELEGRAM_TOKEN,
    telegramChatID: "51818321",
    feeds: {
      googleonlinesecurity: "http://feeds.feedburner.com/GoogleOnlineSecurityBlog",
    },
  },
}[ENV];
