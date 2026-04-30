export default (env) => {
  return {
    production: {
      authentication: true,
      baseURL: "https://rss-doge.melkikh.workers.dev/",
      telegramToken: env.TELEGRAM_TOKEN,
      telegramChatID: "@secpaperboy",
      sentry_dsn: env.SENTRY_DSN,
      updateCount: 10,
      aiModel: "@cf/meta/llama-3.1-8b-instruct",
      aiPrompt:
        "В пользовательском сообщении тебе дают заголовок поста (Title) и текст. Если текст длинный, в нём сшиты начало и конец, середина опущена и помечена как «...» — опирайся на то, что реально попало в запрос. " +
        "Перескажи своими словами так, будто рассказываешь коллеге у кофемашины: коротко, по делу, с интересом, но без пафоса. " +
        "5–7 пунктов. Веди от «о чём речь» к сути и итогу, как в живом разговоре. " +
        "Очень важно: если в посте есть проблематика, вытащи и подсвети те решения, ходы или приёмы, которыми её сняли (или практический know how, если это не история «болезни»). " +
        "Если в видимом тексте уже есть готовые выводы автора — TL;DR, summary, recap, блок «выводы» и т.п. — опирайся на них, не перечёркивай и не игнорируй без причины. " +
        "Избегай канцелярита и пресс-релизного тона: не «ключевые аспекты», не «эксперты компании X», не обобщённые «важно отметить» — говори просто, кто что сделал и что из этого следует. " +
        'Только пункты, каждый с новой строки, с "- "; без вступления и финальных «итого». Только русский. ' +
        "Не переноси слова дефисом между строками; каждый пункт — цельные слова и законченная мысль, не обрывай фразу на середине и не тащи хвост одного пункта в начало следующего.",
      bodyLimit: 2000,
      postsPerMessage: 5,
      feeds: {
        netsec: "https://reddit.com/r/netsec.rss",
        opennet: "https://www.opennet.ru/opennews/opennews_sec.rss",
        meta_engineering: "https://engineering.fb.com/feed/",
        google_online_security: "http://feeds.feedburner.com/GoogleOnlineSecurityBlog",
        google_project_zero: "https://googleprojectzero.blogspot.com/feeds/posts/default",
        google_security: "https://blog.google/technology/safety-security/rss",
        rapid7: "https://blog.rapid7.com/rss/",
        tavis_ormandy: "http://blog.cmpxchg8b.com/feeds/posts/default",
        tailscale: "https://tailscale.com/blog/index.xml",
        datadog_security: "https://securitylabs.datadoghq.com/rss/feed.xml",
        patryk_kosieradzki: "https://patrykkosieradzki.medium.com/feed",
        doyensec: "https://blog.doyensec.com/atom.xml",
        trailofbits: "https://blog.trailofbits.com/feed/",
        miro_engineering: "https://medium.com/feed/miro-engineering",
        raesene: "https://raesene.github.io/feed.xml",
        teleport: "https://goteleport.com/blog/rss.xml",
        cloudflare_security: "https://blog.cloudflare.com/tag/security/rss",
        cloudflare_research: "https://blog.cloudflare.com/tag/research/rss",
        ksoc: "https://ksoc.com/blog/rss.xml",
        okta_security: "https://sec.okta.com/rss.xml",
        unskilled: "https://unskilled.blog/index.xml",
        rami_mac: "https://ramimac.me/feed.xml",
        kanenarraway: "https://kanenarraway.com/index.xml",
        bruce_schneier: "https://www.schneier.com/feed/atom",
        badprivacy: "https://medium.com/feed/@badprivacy",
        
      },
    },
    development: {
      authentication: false,
      baseURL: "http://127.0.0.1:3000/",
      telegramToken: env.TELEGRAM_TOKEN,
      telegramChatID: "51818321",
      sentry_dsn: env.SENTRY_DSN,
      updateCount: 10,
      aiModel: "@cf/meta/llama-3.1-8b-instruct",
      aiPrompt:
        "В пользовательском сообщении тебе дают заголовок поста (Title) и текст. Если текст длинный, в нём сшиты начало и конец, середина опущена и помечена как «...» — опирайся на то, что реально попало в запрос. " +
        "Перескажи своими словами так, будто рассказываешь коллеге у кофемашины: коротко, по делу, с интересом, но без пафоса. " +
        "5–7 пунктов. Веди от «о чём речь» к сути и итогу, как в живом разговоре. " +
        "Очень важно: если в посте есть проблематика, вытащи и подсвети те решения, ходы или приёмы, которыми её сняли (или практический know how, если это не история «болезни»). " +
        "Если в видимом тексте уже есть готовые выводы автора — TL;DR, summary, recap, блок «выводы» и т.п. — опирайся на них, не перечёркивай и не игнорируй без причины. " +
        "Избегай канцелярита и пресс-релизного тона: не «ключевые аспекты», не «эксперты компании X», не обобщённые «важно отметить» — говори просто, кто что сделал и что из этого следует. " +
        'Только пункты, каждый с новой строки, с "- "; без вступления и финальных «итого». Только русский. ' +
        "Не переноси слова дефисом между строками; каждый пункт — цельные слова и законченная мысль, не обрывай фразу на середине и не тащи хвост одного пункта в начало следующего.",
      bodyLimit: 2000,
      postsPerMessage: 5,
      feeds: {
        cloudflare_workers: "https://blog.cloudflare.com/tag/workers/rss",
      },
    },
  }[env.ENVIRONMENT];
};
