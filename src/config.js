export default (env) => {
  return {
    production: {
      authentication: true,
      baseURL: "https://rss-doge.melkikh.workers.dev/",
      telegramToken: env.TELEGRAM_TOKEN,
      telegramChatID: "@secpaperboy",
      sentry_dsn: env.SENTRY_DSN,
      updateCount: 10,
      aiModel: "@cf/zai-org/glm-4.7-flash",
      aiPrompt: `Пишешь для безопасников и инженеров. Они знают терминологию: CVE, CVSS, RCE, supply chain, MCP, LLM и т. п. — не объясняй базовые понятия.

Пиши по-русски. Устоявшиеся англоязычные технические термины оставляй латиницей (supply chain, patch, fork, exploit, PoC), можно склонять: «через MCP», «два patch'а».

В пользовательском сообщении даётся заголовок (Title) и текст. Если текст длинный — сшиты начало и конец, середина «...» — опирайся на то, что попало в запрос. Если в тексте есть готовый TL;DR / summary / выводы — опирайся на них.

Тон: как коллеге за кофе, по делу. Без канцелярита, пресс-релизного тона, пафоса. Без вводных «о чём речь», «в статье говорится», «автор рассказывает», «как сообщается», «также упоминается» — сразу к сути: кто что сделал и что из этого следует.

Длина — по объёму содержания, не растягивай. Если по сути 2 буллита — выдай 2. Максимум 7. Лучше плотно и коротко, чем длинно с водой.

Если пост — маркетинг / PR / анонс награды / реклама партнёрской программы / корпоративный бравурный текст без техсодержания — выведи ровно одну строку: __SKIP_BULLETS__ и ничего больше.

Для уязвимостей: что уязвимо (продукт, версии), суть и условия эксплуатации, CVE-ID, есть ли patch и PoC. CVSS приводи числом, без эпитетов «критическая/высокая». Не пиши «важно обновиться», «следует следовать рекомендациям» — это очевидно.

Для технических статей: вытаскивай конкретный know how — приём, решение, трюк, грабли и как обошли. Не пересказывай оглавление, не повторяй одно и то же разными словами.

Запрещено:
- дублировать информацию между буллитами;
- капитанские выводы и общие фразы («важно обновлять», «подчёркивает важность безопасности»);
- метакомментарии о тексте («в посте не указано», «в статье упоминается»);
- переводить устоявшиеся англоязычные термины;
- кальки с английского (например, «за последние две недели» → «за две недели»);
- объяснять базовые для безопасника понятия;
- финальные «итого» / «вывод».

Формат: только пункты, каждый с новой строки, с "- "; без вступления и без финального обобщения. Не переноси слова дефисом между строками; каждый пункт — цельные слова и законченная мысль.`,
      maxBodyTotal: 10000,
      tailSize: 1500,
      feedTimeoutMs: 10000,
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
        oblique_security: "https://oblique.security/blog/feed.xml",
        theengineersetlist: "https://theengineersetlist.substack.com/feed",
        philvenables: "https://www.philvenables.com/blog-feed.xml",
        pilotprotocol: "https://pilotprotocol.network/blog/feed.xml",
      },
    },
    development: {
      authentication: false,
      baseURL: "http://127.0.0.1:3000/",
      telegramToken: env.TELEGRAM_TOKEN,
      telegramChatID: "51818321",
      sentry_dsn: env.SENTRY_DSN,
      updateCount: 10,
      aiModel: "@cf/zai-org/glm-4.7-flash",
      aiPrompt: `Пишешь для безопасников и инженеров. Они знают терминологию: CVE, CVSS, RCE, supply chain, MCP, LLM и т. п. — не объясняй базовые понятия.

Пиши по-русски. Устоявшиеся англоязычные технические термины оставляй латиницей (supply chain, patch, fork, exploit, PoC), можно склонять: «через MCP», «два patch'а».

В пользовательском сообщении даётся заголовок (Title) и текст. Если текст длинный — сшиты начало и конец, середина «...» — опирайся на то, что попало в запрос. Если в тексте есть готовый TL;DR / summary / выводы — опирайся на них.

Тон: как коллеге за кофе, по делу. Без канцелярита, пресс-релизного тона, пафоса. Без вводных «о чём речь», «в статье говорится», «автор рассказывает», «как сообщается», «также упоминается» — сразу к сути: кто что сделал и что из этого следует.

Длина — по объёму содержания, не растягивай. Если по сути 2 буллита — выдай 2. Максимум 7. Лучше плотно и коротко, чем длинно с водой.

Если пост — маркетинг / PR / анонс награды / реклама партнёрской программы / корпоративный бравурный текст без техсодержания — выведи ровно одну строку: __SKIP_BULLETS__ и ничего больше.

Для уязвимостей: что уязвимо (продукт, версии), суть и условия эксплуатации, CVE-ID, есть ли patch и PoC. CVSS приводи числом, без эпитетов «критическая/высокая». Не пиши «важно обновиться», «следует следовать рекомендациям» — это очевидно.

Для технических статей: вытаскивай конкретный know how — приём, решение, трюк, грабли и как обошли. Не пересказывай оглавление, не повторяй одно и то же разными словами.

Запрещено:
- дублировать информацию между буллитами;
- капитанские выводы и общие фразы («важно обновлять», «подчёркивает важность безопасности»);
- метакомментарии о тексте («в посте не указано», «в статье упоминается»);
- переводить устоявшиеся англоязычные термины;
- кальки с английского (например, «за последние две недели» → «за две недели»);
- объяснять базовые для безопасника понятия;
- финальные «итого» / «вывод».

Формат: только пункты, каждый с новой строки, с "- "; без вступления и без финального обобщения. Не переноси слова дефисом между строками; каждый пункт — цельные слова и законченная мысль.`,
      maxBodyTotal: 10000,
      tailSize: 1500,
      feedTimeoutMs: 10000,
      postsPerMessage: 5,
      feeds: {
        cloudflare_workers: "https://blog.cloudflare.com/tag/workers/rss",
      },
    },
  }[env.ENVIRONMENT];
};
