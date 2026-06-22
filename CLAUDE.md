# rssdoge

Cloudflare Worker: по крону тащит RSS-фиды, суммаризирует посты через Workers AI, шлёт в Telegram.

## Что не очевидно из кода

### Два окружения в `src/config.js` синхронизировать вручную

`production` и `development` — отдельные блоки. `aiPrompt`, `aiModel`, `feedTimeoutMs`, `maxBodyTotal`, `tailSize`, `postsPerMessage` дублируются. При изменении любого из них править оба блока, иначе dev и prod разойдутся.

### Workers AI: response shape зависит от модели

OpenAI-style модели (например, `@cf/zai-org/glm-4.7-flash`) возвращают `result.choices[0].message.content`. Llama-style — плоский `result.response`. Fallback-цепочка в `src/ai.ts` намеренная. При смене модели проверять, что именно она отдаёт, и при необходимости расширять цепочку, а не подменять.

### Пустые буллиты — фича

Посты без `body` и маркетинговые (модель отдаёт ровно `__SKIP_BULLETS__`) идут в Telegram «голой шапкой» через `createPostMarkdown(post, "")`. Не добавлять `continue` / skip-логику: пост должен попасть в канал хотя бы заголовком со ссылкой.

### Маркетинг детектится в том же LLM-вызове

Через маркер `__SKIP_BULLETS__` в промпте. Это сознательный выбор против отдельного классификатора — экономит вызовы и бюджет нейронов. Логика отсева — в промпте (`src/config.js`), не в коде.

### Workers AI free tier — 10k neurons/day

Бюджет общий между моделями. Учитывать при свапе модели: тяжёлые модели могут не пролезть в дневной лимит при текущем расписании крона.

### Reasoning-модели съедают `max_completion_tokens` на thinking

У GLM-4.7-flash и подобных reasoning-моделей `enable_thinking=true` по умолчанию. Бюджет уходит во внутренний CoT, `choices[0].message.content` приходит пустым — пост шлётся «голой шапкой», ошибок в логах нет. Для буллит-саммари thinking не нужен: держать `chat_template_kwargs: { enable_thinking: false }` в `src/ai.ts`. При смене модели — проверять схему ввода на наличие reasoning-флагов.

### Ошибки шлются в Glitchtip, не Sentry

`initSentry`, `ctx.sentry`, `env.SENTRY_DSN`, `toucan-js` — исторические имена, фактически DSN указывает на Glitchtip (он Sentry-совместимый). Дашборд ошибок — Glitchtip, не sentry.io. При работе с SDK помнить, что Glitchtip покрывает лишь подмножество Sentry API (часть фич — performance, profiling — может не работать).
