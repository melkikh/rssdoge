export interface Env {
  RSSDOGE: KVNamespace;
  AI: Ai;
  TELEGRAM_TOKEN: string;
  SENTRY_DSN: string;
  ENVIRONMENT?: string;
  BUILD_TIME?: string;
  RELEASE?: string;
}

export interface AppConfig {
  authentication: boolean;
  baseURL: string;
  telegramToken: string;
  telegramChatID: string;
  sentry_dsn: string;
  updateCount: number;
  aiModel: string;
  aiPrompt: string;
  classifierPrompt: string;
  classifierMaxBodyChars: number;
  minBodyChars: number;
  maxBodyTotal: number;
  tailSize: number;
  feedTimeoutMs: number;
  postsPerMessage: number;
  feeds: Record<string, string>;
}

// Prompt text is identical for prod & dev — kept once here.
const AI_PROMPT = `Пишешь для безопасников и инженеров. Они знают терминологию: CVE, CVSS, RCE, supply chain, MCP, LLM и т. п. — не объясняй базовые понятия.

Язык вывода — только русский. Никаких иероглифов (китайский / японский / корейский). Устоявшиеся англоязычные технические термины оставляй латиницей (supply chain, patch, fork, exploit, PoC), можно склонять: «через MCP», «два patch'а». Названия продуктов, брендов, языков, инструментов — пиши точно как в оригинале, латиницей: PyTorch, GitHub, Python, Docker, Kubernetes, npm, PyPI. Никогда не транслитерируй их («ПиTorch», «ГитХаб» — запрещено).

В пользовательском сообщении даётся заголовок (Title) и текст. Если текст длинный — сшиты начало и конец, середина «...» — опирайся на то, что попало в запрос. Если в тексте есть готовый TL;DR / summary / выводы — опирайся на них.

Опирайся только на факты из тела поста. Не выдумывай CVE-ID, версии, имена, атрибуцию — если этого нет в тексте, не пиши.

Тон: как коллеге за кофе, по делу. Без канцелярита, пресс-релизного тона, пафоса. Без вводных «о чём речь», «в статье говорится», «автор рассказывает», «как сообщается», «также упоминается» — сразу к сути: кто что сделал и что из этого следует.

Длина — по объёму содержания, не растягивай. Если по сути 2 буллита — выдай 2. Максимум 7. Лучше плотно и коротко, чем длинно с водой.

Для уязвимостей: что уязвимо (продукт, версии), суть и условия эксплуатации, CVE-ID, есть ли patch и PoC. CVSS приводи числом, без эпитетов «критическая/высокая». Не пиши «важно обновиться», «следует следовать рекомендациям» — это очевидно.

Для технических статей: вытаскивай конкретный know how — приём, решение, трюк, грабли и как обошли. Не пересказывай оглавление, не повторяй одно и то же разными словами.

Запрещено:
- дублировать информацию между буллитами;
- капитанские выводы и общие фразы («важно обновлять», «подчёркивает важность безопасности»);
- метакомментарии о тексте («в посте не указано», «в статье упоминается»);
- переводить устоявшиеся англоязычные термины;
- кальки с английского (например, «за последние две недели» → «за две недели»);
- объяснять базовые для безопасника понятия;
- финальные «итого» / «вывод»;
- любой markdown (backticks, **bold**, ## заголовки, code fences) — только plain text.

Формат: только пункты, каждый с новой строки, с "- "; без вступления и без финального обобщения. Не переноси слова дефисом между строками; каждый пункт — цельные слова и законченная мысль.`;

const CLASSIFIER_PROMPT = `Ты классификатор постов для канала для безопасников и инженеров.

Отвечай ровно одним словом: PASS или SKIP. Без пояснений, без знаков препинания.

SKIP если пост:
- маркетинг, PR, анонс продукта, реклама;
- анонс награды, партнёрской программы, вакансии, конференции, юбилея;
- корпоративный бравурный / self-congratulatory текст без техсодержания;
- пуст, удалён, содержит "[removed]", "[deleted]", только ссылку или только заголовок без тела.

PASS если пост несёт техническое содержание: уязвимости, разбор атак, инженерные приёмы, исследования, инциденты, обзоры инструментов.

Один пост — один ответ: PASS или SKIP.`;

const FEEDS_PRODUCTION: Record<string, string> = {
  netsec: "https://reddit.com/r/netsec.rss",
  opennet: "https://www.opennet.ru/opennews/opennews_sec.rss",
  meta_engineering: "https://engineering.fb.com/feed/",
  google_online_security:
    "http://feeds.feedburner.com/GoogleOnlineSecurityBlog",
  google_project_zero:
    "https://googleprojectzero.blogspot.com/feeds/posts/default",
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
};

const FEEDS_DEVELOPMENT: Record<string, string> = {
  cloudflare_workers: "https://blog.cloudflare.com/tag/workers/rss",
};

export default function config(env: Env): AppConfig {
  // Fields shared by every environment. Only override what actually differs below.
  const shared = {
    telegramToken: env.TELEGRAM_TOKEN,
    sentry_dsn: env.SENTRY_DSN,
    updateCount: 10,
    aiModel: "@cf/zai-org/glm-4.7-flash",
    aiPrompt: AI_PROMPT,
    classifierPrompt: CLASSIFIER_PROMPT,
    classifierMaxBodyChars: 2000,
    minBodyChars: 100,
    maxBodyTotal: 10000,
    tailSize: 1500,
    feedTimeoutMs: 10000,
    postsPerMessage: 5,
  };

  const environments: Record<string, AppConfig> = {
    production: {
      ...shared,
      authentication: true,
      baseURL: "https://rss-doge.melkikh.workers.dev/",
      telegramChatID: "@secpaperboy",
      feeds: FEEDS_PRODUCTION,
    },
    development: {
      ...shared,
      authentication: false,
      baseURL: "http://127.0.0.1:3000/",
      telegramChatID: "51818321",
      feeds: FEEDS_DEVELOPMENT,
    },
  };

  return environments[env.ENVIRONMENT ?? ""];
}
