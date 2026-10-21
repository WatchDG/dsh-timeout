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

    /** English copy. */
    const en = {
      nav: 'Backoff',
      title: 'Exponential backoff',
      intro:
        'Retries failed tool calls — including calls that hit their deadline — with an exponential backoff: delay = min(maxTimeoutMs, minTimeoutMs × factor^(attempt−1)). The strategy applies inside one tool dispatch, so pre-execution checks and approvals run once, and only the final result reaches the model.',
      statusTitle: 'Live counters',
      statusIntro: 'Since the Host loaded this plugin. Counters are per-Host, not per-session.',
      attempts: 'dispatching attempts',
      retries: 'retries issued',
      timeouts: 'deadline hits',
      lastCode: 'last error code',
      noCode: 'none yet',
      configTitle: 'Behavior',
      configIntro: 'Applies immediately, without a restart.',
      enabledLabel: 'Enabled',
      enabledHint: 'When off, every tool call dispatches exactly once, as DSH does by default.',
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
        'Повторяет упавшие вызовы инструментов — включая вызовы, упёршиеся в таймаут, — с экспоненциальной задержкой: delay = min(maxTimeoutMs, minTimeoutMs × factor^(попытка−1)). Стратегия работает внутри одного вызова: проверки перед выполнением и подтверждения проходят один раз, а модель видит только итоговый результат.',
      statusTitle: 'Живые счётчики',
      statusIntro: 'С момента загрузки плагина хостом. Счётчики общие для хоста, а не на сессию.',
      attempts: 'попыток запуска',
      retries: 'повторных попыток',
      timeouts: 'срабатываний таймаута',
      lastCode: 'последний код ошибки',
      noCode: 'пока нет',
      configTitle: 'Поведение',
      configIntro: 'Применяется сразу, без перезапуска.',
      enabledLabel: 'Включён',
      enabledHint: 'При выключении каждый вызов запускается ровно один раз, как в DSH по умолчанию.',
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
.bo-section{display:flex;flex-direction:column;gap:20px;width:100%;max-width:640px;padding:4px 0 24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
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
      } else if (def.kind === 'number') {
        control = h('input', {
          type: 'number',
          className: 'bo-input',
          value: value === undefined ? '' : String(value),
          min: def.key === 'factor' ? 1.01 : 1,
          step: def.key === 'factor' ? 0.1 : 1,
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
        hint ? h('div', { className: 'bo-hint' }, hint) : null,
      )
    }

    /** The Settings → Backoff section. */
    function Section(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => en[key] ?? key
      const [status, setStatus] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)
      const [draft, setDraft] = React.useState({})
      const [feedback, setFeedback] = React.useState(null)

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
        if (key === 'enabled' || key === 'unlimited' || key === 'armTimeout') {
          next[key] = raw === true
        } else if (key === 'codes' || key === 'tools') {
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

      const readable = status && status !== false
      const readonly = readable && props.readonly
      const unavailable = status === false

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
