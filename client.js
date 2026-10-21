window.__ModuleLoader__.load({
  id: 'dsh-timeout',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.backoff'
    /** Host Loader row id; the settings namespace is the row's patch id. */
    const HOST_ENTRY = 'backoff'
    /** Tolerate a Loader that namespaces the inserted row. */
    const NAMESPACES = [HOST_ENTRY, `include:${HOST_ENTRY}`, 'dsh-timeout']

    /** Authenticated Host route registered by lib/plugin.js. */
    const STATUS_PATH = '/backoff/status'

    /** Jitter modes, matching lib/config.js JITTER_MODES. */
    const JITTER_MODES = ['none', 'equal', 'full']

    /** English copy. */
    const en = {
      nav: 'Backoff',
      title: 'Exponential backoff',
      intro:
        'Retries failed tool calls — including calls that hit their deadline — with an exponential backoff: delay = min(maxTimeoutMs, minTimeoutMs × factor^(attempt−1)). The strategy applies inside one tool dispatch, so pre-execution checks and approvals run once, and only the final result reaches the model. The Model section below retries failed model requests (Retried model request) with the same math, rendered as retry/maximum in chat.',
      statusTitle: 'Live counters',
      statusIntro: 'Since the Host loaded this plugin. Counters are per-Host, not per-session.',
      attempts: 'dispatching attempts',
      retries: 'retries issued',
      timeouts: 'deadline hits',
      lastCode: 'last error code',
      llmAttempts: 'model attempts',
      llmRetries: 'model retries',
      llmLastCode: 'last model code',
      noCode: 'none yet',
      sessionsTitle: 'Per-session activity',
      sessionsIntro: 'Calls that carried an agent, broken down by session. Top activity first.',
      sessionEmpty: 'No retained calls yet.',
      sessionId: 'Session',
      sessionAttempts: 'attempts',
      sessionRetries: 'retries',
      sessionTimeouts: 'timeouts',
      sessionLastCode: 'last code',
      configTitle: 'Tools',
      configIntro: 'Tool retries only. Applies immediately, without a restart. Independent from Model requests below.',
      enabledLabel: 'Enabled (tools)',
      enabledHint: 'When off, every tool call dispatches exactly once, as DSH does by default. Does not affect model retries.',
      unlimitedLabel: 'Unlimited attempts',
      unlimitedHint: 'Ignore max attempts and keep retrying until a call succeeds or you interrupt it. Waits grow up to the max timeout, so an always-failing call keeps pinging.',
      maxAttemptsLabel: 'Max attempts',
      maxAttemptsHint: 'Total attempts per call (including the first), 1 or more.',
      minTimeoutLabel: 'Min timeout (ms)',
      minTimeoutHint: 'First retry delay.',
      maxTimeoutLabel: 'Max timeout (ms)',
      maxTimeoutHint: 'Delay ceiling; a value below min is raised to min.',
      factorLabel: 'Factor',
      factorHint: 'The delay grows by this factor per retry (must be > 1).',
      codesLabel: 'Retry error codes',
      codesHint: 'Comma-separated codes, e.g. TOOL_TIMEOUT, ABORTED. Use * to retry any failure.',
      toolsLabel: 'Tools',
      toolsHint: 'Comma-separated tool names to cover (pwsh, bash, …). Empty = all tools.',
      armTimeoutLabel: 'Enforce per-attempt timeout',
      armTimeoutHint: 'When a tool declares timeoutMs, arm it on each attempt, so a hung call becomes a retryable timeout instead of a stuck dispatch.',
      jitterLabel: 'Jitter',
      jitterHint: 'Randomizes delays to spread parallel retries. None = fixed; Equal = ±ratio around the base; Full = uniform 0..base.',
      'jitterMode.none': 'None (fixed)',
      'jitterMode.equal': 'Equal (±ratio)',
      'jitterMode.full': 'Full (0..base)',
      jitterRatioLabel: 'Jitter ratio',
      jitterRatioHint: 'Spread for Equal jitter: 0.5 = ±50%. Only applies in Equal mode.',
      overridesLabel: 'Per-tool overrides',
      overridesHint: 'Override retry settings for specific tools. Missing fields inherit the global values above.',
      overrideToolPlaceholder: 'tool name, e.g. pwsh',
      overrideAdd: 'Add tool',
      overrideRemove: 'Remove',
      llmTitle: 'Model requests',
      llmIntro: 'Model retries only. Independent from Tools above: own switch, count/unlimited, delays and codes. Retries failed model requests (Retried model request in chat). Unlimited = retry/∞ until success or interrupt; otherwise retry/maxRetries. To control counts from here only, disable the built-in executor for the route (provider retryPolicy maxRetries 0) — otherwise totals add up (built-in + this plugin).',
      llmEnabledLabel: 'Enabled (models)',
      llmEnabledHint: 'When on, Connection error (TRANSPORT) and other selected codes are retried with backoff instead of failing the turn after the built-in budget. Works even when Tools are off.',
      llmUnlimitedLabel: 'Unlimited model retries',
      llmUnlimitedHint: 'Ignore max retries and keep retrying until success or you interrupt it. Each retry is billed as a new request.',
      llmMaxRetriesLabel: 'Max model retries',
      llmMaxRetriesHint: 'Retries after the first failure (5 = built-in default; 10 = longer for flaky networks). Ignored when unlimited.',
      llmMinTimeoutMsLabel: 'Min model delay (ms)',
      llmMinTimeoutMsHint: 'First model retry delay.',
      llmMaxTimeoutMsLabel: 'Max model delay (ms)',
      llmMaxTimeoutMsHint: 'Model delay ceiling; below min is raised to min. Provider Retry-After within the ceiling wins.',
      llmFactorLabel: 'Model factor',
      llmFactorHint: 'Model delay grows by this factor per retry (> 1).',
      llmCodesLabel: 'Model retry codes',
      llmCodesHint: 'Comma-separated, e.g. TRANSPORT, TIMEOUT, SERVER, RATE_LIMIT, EMPTY_RESPONSE. Use * for any failure.',
      llmJitterLabel: 'Model jitter',
      llmJitterHint: 'Equal ±ratio is the built-in style; None = fixed; Full = 0..base.',
      llmJitterRatioLabel: 'Model jitter ratio',
      llmJitterRatioHint: 'Spread for Equal: 0.2 = ±20%.',
      applying: 'Applying…',
      applied: 'Applied.',
      failed: 'The Host did not accept this value; the field was left unchanged.',
      readonly: 'This profile stores settings read-only.',
      unavailable: 'This plugin’s configuration is not served by the Host.',
      refresh: 'Refresh',
      note: 'Retried attempts rerun the same call (same arguments). For tools with side effects, consider restricting `codes` or `tools`, or disabling the plugin, if re-execution is unsafe.',
    }

    /** Russian copy. */
    const ru = {
      nav: 'Бэкoфф',
      title: 'Экспоненциальный бэкoфф',
      intro:
        'Повторяет упавшие вызовы инструментов — включая вызовы, упёршиеся в таймаут, — с экспоненциальной задержкой: delay = min(maxTimeoutMs, minTimeoutMs × factor^(попытка−1)). Стратегия работает внутри одного вызова: проверки перед выполнением и подтверждения проходят один раз, а модель видит только итоговый результат. Раздел «Модель» ниже повторяет упавшие запросы к модели (Retried model request) по той же математике, в чате видно как retry/maximum.',
      statusTitle: 'Живые счётчики',
      statusIntro: 'С момента загрузки плагина хостом. Счётчики общие для хоста, а не на сессию.',
      attempts: 'попыток запуска',
      retries: 'повторных попыток',
      timeouts: 'срабатываний таймаута',
      lastCode: 'последний код ошибки',
      llmAttempts: 'запросов к модели',
      llmRetries: 'повторов модели',
      llmLastCode: 'последний код модели',
      noCode: 'пока нет',
      sessionsTitle: 'Активность по сессиям',
      sessionsIntro: 'Вызовы с агентом, разбитые по сессиям. Сначала самые активные.',
      sessionEmpty: 'Вызовов с агентом пока не было.',
      sessionId: 'Сессия',
      sessionAttempts: 'попыток',
      sessionRetries: 'повторов',
      sessionTimeouts: 'таймаутов',
      sessionLastCode: 'последний код',
      configTitle: 'Инструменты',
      configIntro: 'Только повторы инструментов. Применяется сразу, без перезапуска. Независимо от раздела «Модель» ниже.',
      enabledLabel: 'Включён (инструменты)',
      enabledHint: 'При выключении каждый вызов запускается ровно один раз, как в DSH по умолчанию. На повторы модели не влияет.',
      unlimitedLabel: 'Без ограничения попыток',
      unlimitedHint: 'Игнорировать максимум попыток и повторять, пока вызов не пройдёт или вы не прервёте его. Задержки растут до максимума, поэтому вечно падающий вызов будет повторяться.',
      maxAttemptsLabel: 'Максимум попыток',
      maxAttemptsHint: 'Всего попыток на вызов (включая первую), от 1.',
      minTimeoutLabel: 'Мин. таймаут (мс)',
      minTimeoutHint: 'Задержка первой повторной попытки.',
      maxTimeoutLabel: 'Макс. таймаут (мс)',
      maxTimeoutHint: 'Потолок задержки; значение меньше минимума поднимается до него.',
      factorLabel: 'Фактор',
      factorHint: 'Задержка растёт на этот множитель с каждой попыткой (> 1).',
      codesLabel: 'Коды ошибок для повтора',
      codesHint: 'Коды через запятую, например TOOL_TIMEOUT, ABORTED. Звёздочка * — повторять любую ошибку.',
      toolsLabel: 'Инструменты',
      toolsHint: 'Имена инструментов через запятую (pwsh, bash, …). Пусто — все инструменты.',
      armTimeoutLabel: 'Применять таймаут к попытке',
      armTimeoutHint: 'Если инструмент объявляет timeoutMs, устанавливать его на каждую попытку — зависший вызов станет повторяемым таймаутом, а не зависшей отправкой.',
      jitterLabel: 'Джиттер',
      jitterHint: 'Случайно «размазывает» задержки, чтобы параллельные повторы не били синхронно. None — фиксированно; Equal — ±ratio вокруг базовой; Full — равномерно 0..base.',
      'jitterMode.none': 'Нет (фиксированно)',
      'jitterMode.equal': 'Равномерно (±ratio)',
      'jitterMode.full': 'Полный (0..base)',
      jitterRatioLabel: 'Доля джиттера',
      jitterRatioHint: 'Разброс для режима Equal: 0.5 = ±50%. Применяется только в режиме Equal.',
      overridesLabel: 'Переопределения по инструментам',
      overridesHint: 'Переопределяют настройки повторов для конкретных инструментов. Незаполненные поля наследуют глобальные значения выше.',
      overrideToolPlaceholder: 'имя инструмента, например pwsh',
      overrideAdd: 'Добавить инструмент',
      overrideRemove: 'Удалить',
      llmTitle: 'Запросы к модели',
      llmIntro: 'Только повторы модели. Независимо от Инструментов выше: свой тумблер, кол-во/безлимит, задержки и коды. Повторяет упавшие запросы к модели (Retried model request в чате). Без ограничения = retry/∞ до успеха или прерывания; иначе retry/maxRetries. Чтобы счёт вёл только этот плагин, отключите встроенный исполнитель для маршрута (retryPolicy maxRetries 0 у провайдера) — иначе итоги складываются (встроенный + этот плагин).',
      llmEnabledLabel: 'Включён (модель)',
      llmEnabledHint: 'Когда включено, Connection error (TRANSPORT) и другие выбранные коды повторяются с задержкой, а не роняют ход после встроенного бюджета. Работает, даже когда Инструменты выключены.',
      llmUnlimitedLabel: 'Без ограничения повторов модели',
      llmUnlimitedHint: 'Игнорировать максимум и повторять до успеха или прерывания. Каждый повтор — новый биллингуемый запрос.',
      llmMaxRetriesLabel: 'Максимум повторов модели',
      llmMaxRetriesHint: 'Повторов после первой ошибки (5 = встроенный дефолт; 10 = дольше для нестабильной сети). Игнорируется при безлимите.',
      llmMinTimeoutMsLabel: 'Мин. задержка модели (мс)',
      llmMinTimeoutMsHint: 'Задержка первого повтора модели.',
      llmMaxTimeoutMsLabel: 'Макс. задержка модели (мс)',
      llmMaxTimeoutMsHint: 'Потолок задержки; ниже минимума поднимается до него. Валидный Retry-After провайдера в пределах потолка побеждает.',
      llmFactorLabel: 'Фактор модели',
      llmFactorHint: 'Задержка модели растёт на этот множитель с каждой попыткой (> 1).',
      llmCodesLabel: 'Коды повтора модели',
      llmCodesHint: 'Через запятую, например TRANSPORT, TIMEOUT, SERVER, RATE_LIMIT, EMPTY_RESPONSE. * — любая ошибка.',
      llmJitterLabel: 'Джиттер модели',
      llmJitterHint: 'Equal ±ratio — встроенный стиль; None — фиксированно; Full — 0..base.',
      llmJitterRatioLabel: 'Доля джиттера модели',
      llmJitterRatioHint: 'Разброс для Equal: 0.2 = ±20%.',
      applying: 'Применяю…',
      applied: 'Применено.',
      failed: 'Хост не принял значение; поле осталось прежним.',
      readonly: 'В этом профиле настройки доступны только для чтения.',
      unavailable: 'Хост не отдаёт конфигурацию этого плагина.',
      refresh: 'Обновить',
      note: 'Повторные попытки запускают тот же вызов (те же аргументы). Для инструментов с побочными эффектами стоит сузить `codes` или `tools` либо выключить плагин, если повторный запуск небезопасен.',
    }

    /** Page-local styles; tokens only, so light/dark follows the host theme. */
    const CSS = `
.bo-section{display:flex;flex-direction:column;gap:20px;width:100%;max-width:680px;padding:4px 0 24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.bo-title{margin:0;font-size:16px;font-weight:600}
.bo-sub{margin:24px 0 0;padding-top:16px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:16px;font-weight:600}
.bo-intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px}
.bo-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:18px}
.bo-row{display:flex;flex-direction:column;gap:6px}
.bo-label{font-size:13px;font-weight:500}
.bo-input{height:32px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}
.bo-input:focus-visible,.bo-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.bo-input:disabled{color:var(--dsw-alias-label-secondary);cursor:not-allowed}
.bo-check{display:flex;align-items:center;gap:8px;font-size:13px}
.bo-check input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}
.bo-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.bo-actions{display:flex;gap:8px;flex-wrap:wrap}
.bo-button{height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}
.bo-button:disabled{color:var(--dsw-alias-label-secondary);cursor:not-allowed}
.bo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.bo-stat{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.bo-stat b{font-size:15px;font-weight:600}
.bo-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.bo-sess{display:flex;flex-direction:column;gap:6px}
.bo-sess-row{display:grid;grid-template-columns:minmax(120px,1.4fr) repeat(3,minmax(60px,.6fr)) minmax(80px,.9fr);gap:8px;align-items:center;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:16px}
.bo-sess-row b{font-weight:600}
.bo-sess-row span{color:var(--dsw-alias-label-secondary)}
.bo-overrides{display:flex;flex-direction:column;gap:12px}
.bo-override{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}
.bo-override-head{display:flex;align-items:center;gap:8px}
.bo-override-head .bo-input{flex:1;min-width:120px}
.bo-override-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.bo-note{margin:4px 0 0;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
`

    /** Stable field descriptors for the editable behavior form. */
    const FIELD_DEFS = [
      { key: 'enabled', kind: 'boolean' },
      { key: 'unlimited', kind: 'boolean' },
      { key: 'maxAttempts', kind: 'number' },
      { key: 'minTimeoutMs', kind: 'number' },
      { key: 'maxTimeoutMs', kind: 'number' },
      { key: 'factor', kind: 'number' },
      { key: 'codes', kind: 'csv' },
      { key: 'tools', kind: 'csv' },
      { key: 'armTimeout', kind: 'boolean' },
      { key: 'jitter', kind: 'select' },
      { key: 'jitterRatio', kind: 'number' },
    ]

    /** Model-request retry fields (llm* in the Host config). */
    const LLM_FIELD_DEFS = [
      { key: 'llmEnabled', kind: 'boolean' },
      { key: 'llmUnlimited', kind: 'boolean' },
      { key: 'llmMaxRetries', kind: 'number' },
      { key: 'llmMinTimeoutMs', kind: 'number' },
      { key: 'llmMaxTimeoutMs', kind: 'number' },
      { key: 'llmFactor', kind: 'number' },
      { key: 'llmCodes', kind: 'csv' },
      { key: 'llmJitter', kind: 'select' },
      { key: 'llmJitterRatio', kind: 'number' },
    ]

    /** Fields available inside each per-tool override row. */
    const OVERRIDE_FIELD_DEFS = [
      { key: 'maxAttempts', kind: 'number' },
      { key: 'unlimited', kind: 'boolean' },
      { key: 'codes', kind: 'csv' },
      { key: 'minTimeoutMs', kind: 'number' },
      { key: 'maxTimeoutMs', kind: 'number' },
      { key: 'factor', kind: 'number' },
      { key: 'armTimeout', kind: 'boolean' },
      { key: 'jitter', kind: 'select' },
      { key: 'jitterRatio', kind: 'number' },
    ]

    /** One editable row: label, hint, input, and commit-on-change. */
    function Field({ t, def, value, disabled, onChange }) {
      const label = t(`${def.key}Label`)
      const hint = t(`${def.key}Hint`)
      let control
      if (def.kind === 'boolean') {
        control = h('label', { className: 'bo-check' },
          h('input', {
            type: 'checkbox',
            checked: value === true,
            disabled,
            onChange: (event) => onChange(event.target.checked),
          }),
          label,
        )
      } else if (def.kind === 'select') {
        control = h('select', {
          className: 'bo-input',
          value: value === undefined ? 'equal' : value,
          disabled,
          onChange: (event) => onChange(event.target.value),
        },
          JITTER_MODES.map((mode) =>
            h('option', { key: mode, value: mode }, t(`jitterMode.${mode}`)),
          ),
        )
      } else if (def.kind === 'number') {
        const isFactor = def.key === 'factor' || def.key === 'llmFactor'
        const isRatio = def.key === 'jitterRatio' || def.key === 'llmJitterRatio'
        const isLlmRetries = def.key === 'llmMaxRetries'
        control = h('input', {
          type: 'number',
          className: 'bo-input',
          value: value === undefined ? '' : String(value),
          min: isFactor ? 1.01 : isRatio ? 0 : isLlmRetries ? 0 : 1,
          max: isRatio ? 1 : undefined,
          step: isFactor ? 0.1 : isRatio ? 0.05 : 1,
          disabled,
          onChange: (event) => onChange(event.target.value),
        })
      } else {
        control = h('input', {
          type: 'text',
          className: 'bo-input',
          value: Array.isArray(value) ? value.join(', ') : '',
          disabled,
          onChange: (event) => onChange(event.target.value),
        })
      }
      return h('div', { className: 'bo-row' },
        def.kind === 'boolean' ? null : h('label', { className: 'bo-label' }, label),
        control,
        hint && hint !== `${def.key}Hint` ? h('div', { className: 'bo-hint' }, hint) : null,
      )
    }

    /** One per-tool override row. */
    function OverrideRow({ t, tool, value, disabled, onChange, onRemove }) {
      const row = value && typeof value === 'object' ? value : {}
      const patch = (key, raw) => {
        const next = { ...row }
        if (key === 'unlimited' || key === 'armTimeout') {
          next[key] = raw === true
        } else if (key === 'codes' || key === 'tools') {
          next[key] = typeof raw === 'string' ? raw.split(',').map((v) => v.trim()).filter(Boolean) : raw
        } else if (key === 'jitter') {
          next[key] = raw
        } else {
          const number = Number(raw)
          next[key] = Number.isFinite(number) ? number : undefined
          if (next[key] === undefined) delete next[key]
        }
        onChange(next)
      }
      return h('div', { className: 'bo-override' },
        h('div', { className: 'bo-override-head' },
          h('input', {
            type: 'text',
            className: 'bo-input',
            value: tool,
            placeholder: t('overrideToolPlaceholder'),
            disabled,
            onChange: (event) => onChange(null, event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'bo-button',
            disabled,
            onClick: onRemove,
          }, t('overrideRemove')),
        ),
        h('div', { className: 'bo-override-fields' },
          OVERRIDE_FIELD_DEFS.map((def) =>
            h(Field, {
              key: def.key,
              t,
              def,
              value: row[def.key],
              disabled,
              onChange: (raw) => patch(def.key, raw),
            }),
          ),
        ),
      )
    }

    /** The Settings → Backoff section. */
    function Section(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => en[key] ?? key
      const [status, setStatus] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)
      const [draft, setDraft] = React.useState({})
      const [feedback, setFeedback] = React.useState(null)
      const [newTool, setNewTool] = React.useState('')

      React.useEffect(() => {
        let alive = true
        setStatus(null)
        props
          .fetchStatus()
          .then((payload) => {
            if (!alive) return
            setStatus(payload)
            setDraft({
              enabled: payload.enabled,
              unlimited: payload.settings.unlimited,
              maxAttempts: payload.settings.maxAttempts,
              minTimeoutMs: payload.settings.minTimeoutMs,
              maxTimeoutMs: payload.settings.maxTimeoutMs,
              factor: payload.settings.factor,
              codes: payload.settings.codes,
              tools: payload.settings.tools,
              armTimeout: payload.settings.armTimeout,
              jitter: payload.settings.jitter,
              jitterRatio: payload.settings.jitterRatio,
              overrides: payload.settings.toolOverrides ?? {},
              llmEnabled: payload.settings.llmEnabled,
              llmUnlimited: payload.settings.llmUnlimited,
              llmMaxRetries: payload.settings.llmMaxRetries,
              llmMinTimeoutMs: payload.settings.llmMinTimeoutMs,
              llmMaxTimeoutMs: payload.settings.llmMaxTimeoutMs,
              llmFactor: payload.settings.llmFactor,
              llmCodes: payload.settings.llmCodes,
              llmJitter: payload.settings.llmJitter,
              llmJitterRatio: payload.settings.llmJitterRatio,
            })
          })
          .catch(() => {
            if (alive) setStatus(false)
          })
        return () => {
          alive = false
        }
      }, [nonce])

      const commit = (key, raw) => {
        const next = {}
        if (key === 'enabled' || key === 'unlimited' || key === 'armTimeout' || key === 'llmEnabled' || key === 'llmUnlimited') {
          next[key] = raw === true
        } else if (key === 'jitter' || key === 'llmJitter') {
          next[key] = raw
        } else if (key === 'codes' || key === 'tools' || key === 'llmCodes') {
          next[key] = typeof raw === 'string' ? raw.split(',').map((v) => v.trim()).filter(Boolean) : raw
        } else {
          const number = Number(raw)
          next[key] = Number.isFinite(number) ? number : draft[key]
        }
        setDraft((current) => ({ ...current, ...next }))
        setFeedback({ state: 'applying' })
        Promise.resolve()
          .then(() => props.setField(key, next[key]))
          .then(() => setFeedback({ state: 'applied' }))
          .catch(() => setFeedback({ state: 'failed' }))
      }

      const commitOverrides = (overrides) => {
        setDraft((current) => ({ ...current, overrides }))
        setFeedback({ state: 'applying' })
        Promise.resolve()
          .then(() => props.setField('toolOverrides', overrides))
          .then(() => setFeedback({ state: 'applied' }))
          .catch(() => setFeedback({ state: 'failed' }))
      }

      const changeOverride = (oldTool, nextValue, newTool) => {
        const overrides = { ...(draft.overrides ?? {}) }
        if (newTool !== undefined) {
          delete overrides[oldTool]
          if (newTool.trim()) overrides[newTool.trim()] = nextValue
        } else if (nextValue === null) {
          delete overrides[oldTool]
        } else {
          overrides[oldTool] = nextValue
        }
        commitOverrides(overrides)
      }

      const addOverride = () => {
        const name = newTool.trim()
        if (!name) return
        const overrides = { ...(draft.overrides ?? {}) }
        if (!(name in overrides)) overrides[name] = {}
        setNewTool('')
        commitOverrides(overrides)
      }

      const readable = status && status !== false
      const readonly = readable && props.readonly
      const unavailable = status === false
      const overrideRows = Object.entries(draft.overrides ?? {})

      return h(
        'div',
        { className: 'bo-section' },
        h('style', { key: 'styles' }, CSS),
        h('h2', { className: 'bo-title' }, t('title')),
        h('p', { className: 'bo-intro' }, t('intro')),

        h('h3', { className: 'bo-sub' }, t('statusTitle')),
        h('p', { className: 'bo-intro' }, t('statusIntro')),
        !readable
          ? h('p', { className: 'bo-hint' }, unavailable ? t('unavailable') : t('applying'))
          : h('div', { className: 'bo-grid' },
              h('div', { className: 'bo-stat' }, h('b', null, status.stats.attempts), h('span', null, t('attempts'))),
              h('div', { className: 'bo-stat' }, h('b', null, status.stats.retries), h('span', null, t('retries'))),
              h('div', { className: 'bo-stat' }, h('b', null, status.stats.timeouts), h('span', null, t('timeouts'))),
              h('div', { className: 'bo-stat' },
                h('b', null, status.stats.lastCode ?? t('noCode')),
                h('span', null, t('lastCode')),
              ),
              h('div', { className: 'bo-stat' }, h('b', null, status.stats.llmAttempts ?? 0), h('span', null, t('llmAttempts'))),
              h('div', { className: 'bo-stat' }, h('b', null, status.stats.llmRetries ?? 0), h('span', null, t('llmRetries'))),
              h('div', { className: 'bo-stat' },
                h('b', null, status.stats.llmLastCode ?? t('noCode')),
                h('span', null, t('llmLastCode')),
              ),
            ),

        h('h3', { className: 'bo-sub' }, t('sessionsTitle')),
        h('p', { className: 'bo-intro' }, t('sessionsIntro')),
        !readable
          ? null
          : status.sessions.length === 0
            ? h('p', { className: 'bo-hint' }, t('sessionEmpty'))
            : h('div', { className: 'bo-sess' },
                status.sessions.map((row) => {
                  const shortId = String(row.sessionId).length > 16 ? `${String(row.sessionId).slice(0, 14)}…` : String(row.sessionId)
                  return h('div', { key: row.sessionId, className: 'bo-sess-row' },
                    h('b', null, shortId),
                    h('span', null, `${row.attempts} ${t('sessionAttempts')}`),
                    h('span', null, `${row.retries} ${t('sessionRetries')}`),
                    h('span', null, `${row.timeouts} ${t('sessionTimeouts')}`),
                    h('span', null, row.lastCode ?? t('noCode')),
                  )
                }),
              ),

        h('h3', { className: 'bo-sub' }, t('configTitle')),
        h('p', { className: 'bo-intro' }, t('configIntro')),
        ...FIELD_DEFS.map((def) =>
          h(Field, {
            key: def.key,
            t,
            def,
            value: draft[def.key],
            disabled: !readable || readonly,
            onChange: (raw) => commit(def.key, raw),
          }),
        ),
        feedback
          ? h('p', { className: 'bo-hint' }, t(feedback.state === 'applying' ? 'applying' : feedback.state === 'applied' ? 'applied' : 'failed'))
          : null,

        h('h3', { className: 'bo-sub' }, t('llmTitle')),
        h('p', { className: 'bo-intro' }, t('llmIntro')),
        ...LLM_FIELD_DEFS.map((def) =>
          h(Field, {
            key: def.key,
            t,
            def,
            value: draft[def.key],
            disabled: !readable || readonly,
            onChange: (raw) => commit(def.key, raw),
          }),
        ),

        h('h3', { className: 'bo-sub' }, t('overridesLabel')),
        h('p', { className: 'bo-intro' }, t('overridesHint')),
        h('div', { className: 'bo-overrides' },
          overrideRows.map(([tool, row]) =>
            h(OverrideRow, {
              key: tool,
              t,
              tool,
              value: row,
              disabled: !readable || readonly,
              onChange: (nextValue, nextTool) => changeOverride(tool, nextValue, nextTool),
              onRemove: () => changeOverride(tool, null),
            }),
          ),
        ),
        h('div', { className: 'bo-actions' },
          h('input', {
            type: 'text',
            className: 'bo-input',
            style: { minWidth: '180px' },
            value: newTool,
            placeholder: t('overrideToolPlaceholder'),
            disabled: !readable || readonly,
            onChange: (event) => setNewTool(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'bo-button',
            disabled: !readable || readonly || !newTool.trim(),
            onClick: addOverride,
          }, t('overrideAdd')),
        ),

        h('div', { className: 'bo-actions' },
          h('button', {
            type: 'button',
            className: 'bo-button',
            disabled: status === null,
            onClick: () => setNonce((value) => value + 1),
          }, t('refresh')),
        ),
        h('p', { className: 'bo-note' }, t('note')),
      )
    }

    /** Required services. `configForms` is provided by the Settings plugin. */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Register the dictionaries and the section while the Host serves its
     * configuration namespace.
     * @param {object} ctx - browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'dsh-timeout: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(
        () =>
          ctx.configForms.whileServed(NAMESPACES, (served) => {
            const namespace = NAMESPACES.find((candidate) => served.has(candidate))
            if (namespace === undefined) return () => {}
            const form = ctx.configForms.get(namespace)
            return ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'backoff',
                  order: 19,
                  label: () => t('nav'),
                  locale: NS,
                  inject: () => ({
                    hooks: { env: form },
                    setField: (field, next) => form.set(field, next),
                    readonly: form.readonly === true,
                    fetchStatus: async () => {
                      const response = await fetch(STATUS_PATH, {
                        method: 'GET',
                        headers: { accept: 'application/json' },
                        cache: 'no-store',
                      })
                      if (!response.ok) throw new Error(`dsh-timeout: status HTTP ${response.status}`)
                      return response.json()
                    },
                    form,
                  }),
                },
                Section,
              ),
            )
          }),
        'dsh-timeout: settings page',
      )
    }

    return { inject, apply }
  },
})
