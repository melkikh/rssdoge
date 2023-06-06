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
      patryk_kosieradzki: "https://patrykkosieradzki.medium.com/feed",
      github_security: "https://github.blog/category/security/feed",
      microsoft_engineering: "https://devblogs.microsoft.com/engineering-at-microsoft/feed/",
      microsoft_entra: "https://devblogs.microsoft.com/identity/feed/",
      microsoft_defender_for_cloud: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=MicrosoftDefenderCloudBlog&size=25&label=Cloud%20Security%20Posture%20Management",
      microsoft_security: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=MicrosoftSecurityandCompliance&size=25",
      microsoft_core_infra_security: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=CoreInfrastructureandSecurityBlog&size=25",
      microsoft_network_security: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=AzureNetworkSecurityBlog&size=25",
      microsoft_defender_for_endpoint: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=MicrosoftDefenderATPBlog&size=25",
      microsoft_entra: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=Identity&size=25",
      microsoft_sentinel: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=MicrosoftSentinelBlog&size=25",
      microsoft_vulnmanagement: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=Vulnerability-Management&size=25",
      microsoft_identity: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?tid=-3601065208085691870&board=IdentityStandards&size=25",
      doyensec: "https://blog.doyensec.com/atom.xml",
      github_security_changelog: "https://github.blog/changelog/label/advanced-security/feed/",
      github_advanced_security_changelog: "https://github.blog/changelog/label/security/feed/",
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
