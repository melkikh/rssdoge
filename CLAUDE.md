# rssdoge

Cloudflare Worker: по крону тащит RSS-фиды, суммаризирует посты через Workers AI, шлёт в Telegram.

## Что не очевидно из кода

### Два окружения в `src/config.js` синхронизировать вручную

`production` и `development` — отдельные блоки. Дублируются: `aiPrompt`, `classifierPrompt`, `classifierMaxBodyChars`, `aiModel`, `feedTimeoutMs`, `maxBodyTotal`, `tailSize`, `postsPerMessage`. При изменении любого из них править оба блока, иначе dev и prod разойдутся.

### Workers AI: response shape зависит от модели

OpenAI-style модели (например, `@cf/zai-org/glm-4.7-flash`) возвращают `result.choices[0].message.content`. Llama-style — плоский `result.response`. Хелпер `extractContent()` в `src/ai.ts` намеренно склеивает оба варианта. При смене модели проверять, что именно она отдаёт, и при необходимости расширять цепочку, а не подменять.

### Двухступенчатый LLM-pipeline: classify → summarize

Для каждого поста с непустым `body` сначала `classifyPost()` (`max_completion_tokens: 10`, один токен `PASS`/`SKIP`), затем — только если не `SKIP` — `summarizePost()`. Модель одна и та же (GLM), промпты разные (`classifierPrompt` / `aiPrompt`). Так надёжнее, чем один вызов с гибридным промптом: маленькая фокусированная задача классификатора vs. большая многозадачная summary.

Классификатор возвращает `PASS` / `SKIP` / `UNKNOWN`. На `UNKNOWN` — fall-through в summary (не терять пост) + warning в Glitchtip. `SKIP` шлётся молча голой шапкой (это по замыслу; если хочется видимости false-positive skip'ов — добавить логирование под флагом).

Safety net: если модель в саммари всё же выплюнет `__SKIP_BULLETS__` (промпт про него уже не говорит), `index.ts` его всё равно ловит и превращает в голую шапку.

### Пустые буллиты — фича, причин четыре

Пост идёт в Telegram голой шапкой (`createPostMarkdown(post, "")`) в четырёх случаях:
1. `!post.body` — фид не отдал тело;
2. `classification === "SKIP"` — классификатор отсеял;
3. `sanitizeBullets` отбросил вывод (CJK ≥2 символов или после нормализации пусто);
4. `bullets.trim() === "__SKIP_BULLETS__"` (legacy safety net).

Не добавлять `continue` / skip-логику: пост должен попасть в канал хотя бы заголовком со ссылкой.

### Санитайзер вывода саммари (`src/ai.ts`)

После `ai.run` результат прогоняется через `sanitizeBullets()`:
- `hasTooManyCJK` — если в тексте ≥2 CJK-символа (китайский/японский/корейский), bullets отбрасываются целиком. Порог `>=2` — потому что модель галлюцинирует CJK парами (`全球`, `攻击`); одиночный иероглиф теоретически может быть легитимен (имя автора и т.п.).
- `stripMarkdown` — режет backticks, `**bold**`, `*italic*`, `## headings`, code fences. Причина: `parse_mode: html` в Telegram, markdown отрисуется как литералы.
- `normalizeBullets` — прибивает `- ` префикс каждой непустой строке, если модель забыла формат.

При отбросе (CJK) `SummaryResult.rejectedReason = "cjk"` — этот тег уходит в Glitchtip warning, чтобы отслеживать частоту.

### KV курсор двигается только для успешных тегов

`ctx.kv.updateValues(...)` в `finally` (`src/index.ts`) получает не все `Object.keys(feeds)`, а только те, что **не попали в `failedTags`**. В `failedTags` добавляется тег при (а) фейле `fetchFeed`, (б) фейле `bot.sendMessage` на чанке, куда попал пост этого тега.

Trade-off: если один пост тега упал, а другой того же тега успешно ушёл — курсор не двинется, второй пост будет отправлен повторно на следующем крон-запуске (дубль). Это сознательный выбор: приоритет — не терять посты, лучше дубль. Если решишь поменять на per-post трекинг — потребуется отдельный KV-ключ на пост.

### Telegram 4096 символов — `chunkParts` в `src/utils.ts`

Лимит `sendMessage` = 4096 UTF-16 code units. `postsPerMessage: 5` сам по себе не спасает: 5 постов с жирными буллитами вылезают за лимит и TG возвращает 400. `chunkParts()` разбивает батч на подчанки ≤`TELEGRAM_MAX_MESSAGE`; если единичный пост длиннее — обрезает по последней `\n` с суффиксом `…`.

При провале сенда падает **чанк**, а не весь батч: только теги постов этого чанка попадают в `failedTags`, остальные посты того же батча уже могут быть отправлены другими чанками.

### Workers AI free tier — 10k neurons/day

Бюджет общий между моделями. По грубой оценке при текущем крон-расписании (`0,30 9-18 mon-fri`, 20 запусков × ~3 поста × ~40 neurons) — ~2400 n/day, запас 4×. При смене модели или увеличении `updateCount`/`postsPerMessage` пересчитывать. Классификатор дёшев (`max_completion_tokens: 10`), его вклад пренебрежимо мал.

### Workers AI free tier — 10k neurons/day

Бюджет общий между моделями. Учитывать при свапе модели: тяжёлые модели могут не пролезть в дневной лимит при текущем расписании крона.

### Reasoning-модели съедают `max_completion_tokens` на thinking

У GLM-4.7-flash и подобных reasoning-моделей `enable_thinking=true` по умолчанию. Бюджет уходит во внутренний CoT, `choices[0].message.content` приходит пустым — пост шлётся «голой шапкой», ошибок в логах нет. Для буллит-саммари thinking не нужен: держать `chat_template_kwargs: { enable_thinking: false }` в `src/ai.ts`. При смене модели — проверять схему ввода на наличие reasoning-флагов.

### Ошибки шлются в Glitchtip, не Sentry

`initSentry`, `ctx.sentry`, `env.SENTRY_DSN`, `toucan-js` — исторические имена, фактически DSN указывает на Glitchtip (он Sentry-совместимый). Дашборд ошибок — Glitchtip, не sentry.io. При работе с SDK помнить, что Glitchtip покрывает лишь подмножество Sentry API (часть фич — performance, profiling — может не работать).
