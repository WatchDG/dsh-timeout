# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-11-10

### Fixed

- Model retries no longer fail on `This turn failed` / `Connection error.
  PI_AI_ERROR` when `llmEnabled` is on. Custom pi-ai adapters (e.g.
  `dsh-opencode`) map every terminal stream error to the catch-all
  `PI_AI_ERROR` code instead of classifying it, so the default `llmCodes`
  (`EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT`) never matched and the
  turn died before this plugin's backoff chain could run. A thrown, non-Harness
  transport error reaches `agent/request-error` as `UNKNOWN` for the same
  reason. `isLlmRetryable` now reclassifies these unclassified codes from
  `failure.message` (mirroring DSH's `classifyPiAiError` plus pi-ai's own
  `isRetryableAssistantError` wording), so `Connection error.` is recognized as
  `TRANSPORT`, `HTTP 503` as `SERVER`, `timed out` as `TIMEOUT`, etc. Explicit
  failure codes still win, quota/billing text stays non-retryable, and
  unrelated generic errors (`pi-ai stream ended pending`) are still terminal.
- Documentation corrected: `Connection error` is `TRANSPORT` only in DSH's
  shipped pi-ai adapter; third-party adapters emit `PI_AI_ERROR`, which this
  plugin now handles.

## [0.4.0] - 2026-11-09

### Changed

- Adapted to DeepSeek Harness 0.2.2-RC.1 (Cordis 4.1.0). Tool retries were
  re-implemented: 0.2.2 makes every waterfall `next()` single-use (a second call
  throws `next() called multiple times`), so the wrapper now calls `next()`
  exactly once for attempt 1 and re-runs the tool body directly through the
  resolved `ToolDefinition` for every retry. Retried attempts keep the original
  call identity, run `tools/pre-execute` and its approvals once, and still get
  exactly one `tools/post-execute` / `tools/result` pass. Previously every
  retry after the first threw, and the synthetic
  `next() called multiple times` error reached the model instead of the tool
  error.
- Tool definition lookup now prefers `ctx.tools.executable(name, agent,
  exec.toolSet)` — the 0.2.2 execution lookup, which applies the step's resolved
  tool set so conditionally activated tools resolve correctly — and falls back
  to `ctx.tools.get(name, agent)`.
- Minimum runtime is Node.js 24.9 (`engines.node >= 24.9.0`), matching the DSH
  0.2.2 requirement.
- Settings → Backoff: read-only profiles are detected through
  `form.getSnapshot().writable === false` instead of the nonexistent
  `form.readonly`, so the form is actually disabled when the profile stores
  settings read-only.
- Settings → Backoff: a refused save (`form.set` returns `false`) reports a
  failure instead of `Applied.` (new `saveFailed` copy in English and Russian).

### Removed

- The deprecated `ctx.sessionProjections.stateOf(session, key)` read and the
  `sessionProjections` / `agents` injections. The read was dead code — no
  projection unit was ever registered for its key — and 0.2.2 deprecates the
  service-level call in favour of an awaited registration handle. Model-retry
  chain state is now explicitly process-local per session and still resets on a
  new turn/step; durable `llm/retry` / `tool/retry` session events are
  unchanged. This also corrects the 0.3.0 note that claimed durable counters
  through a `backoffLlmRetry` projection.

### Fixed

- A tool body that rejects on the per-attempt deadline now reports
  `TOOL_TIMEOUT` (and counts a timeout) instead of returning the raw abort
  error, which is not retryable by default.

## [0.3.2] - 2026-10-27

### Fixed

- Settings → Backoff: per-session activity now renders the model counters
  (`llmAttempts`/`llmRetries`/`llmLastCode`) alongside the tool counters.
  Previously a session with real model retries showed `retries: 0`, because the
  table only displayed tool retries even though `GET /backoff/status` already
  served the model counters per session.
- Live counters now re-read `GET /backoff/status` every 3 s while the section is
  open (and when the tab becomes visible) instead of only on mount, so retries
  that happen after the page loaded are no longer displayed as stale zeros.
- Counter labels now state explicitly whether a number is a tool counter or a
  model counter (`tool attempts`, `tool retries`, `model retries`, …).

## [0.3.1] - 2026-10-21

### Fixed

- LLM retry chain now resets on a new turn/step (like built-in llm-retry):
  without this, one exhausted `10/10` silently disabled all later model
  retries for the session, leaving only the built-in `1/5` chains.

## [0.3.0] - 2026-10-21

### Added

- Model-request retries (`agent/request-error`): `llmEnabled` master switch,
  `llmMaxRetries` count or `llmUnlimited` for `retry/∞`, with `llmMinTimeoutMs`,
  `llmMaxTimeoutMs`, `llmFactor`, `llmCodes`, `llmJitter`/`llmJitterRatio`.
  Emits chat-compatible `llm/retry` / `llm/retry-started` so the UI shows
  `Retried model request (retry/maximum)`; honors provider `Retry-After`
  within the ceiling and tracks durable counters via `backoffLlmRetry`.
- Settings → Backoff: Model requests section with live `llmAttempts` /
  `llmRetries` / `llmLastCode` counters.
- Docs: how to count from this plugin only (provider `retryPolicy maxRetries 0`)
  vs additive totals (built-in + plugin).

## [0.2.0] - 2026-10-21

### Added

- Jitter for retry delays: `jitter: none | equal | full` (default `equal`)
  with a `jitterRatio` spread setting (default 0.5 = ±50 %). Spreads parallel
  retries so they do not hit a service synchronously.
- Per-tool policy overrides (`toolOverrides`): a map of tool name → partial
  settings (max attempts, unlimited, codes, min/max timeout, factor, timeout
  arming, jitter); missing fields inherit the global values.
- Durable session events: each scheduled retry appends `tool/retry`
  (`callId`, `tool`, `attempt`, `code`, `delayMs`) and `tool/retry-started`
  to the session log, mirroring `llm-retry`.
- Per-session counters on the Host, served by `GET /backoff/status` and shown
  as an activity table on the Settings page.
- Settings page controls for jitter and per-tool overrides.

## [0.1.0] - 2026-10-21

### Added

- Initial production release of the DSH bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/).
- `tools/execute` wrapper that retries failed tool calls with an exponential
  backoff: `delay = min(maxTimeoutMs, minTimeoutMs × factor^(attempt−1))`.
- Configuration: `enabled`, `maxAttempts`, `unlimited`, `minTimeoutMs`,
  `maxTimeoutMs`, `factor`, `codes`, `tools`, `armTimeout`.
- Per-attempt deadline enforcement: when a tool declares `timeoutMs` and
  `armTimeout` is on, each attempt gets its own budget and a deadline hit
  becomes a retryable `TOOL_TIMEOUT` result.
- Settings → Backoff page with live Host counters and an editable, volatile
  configuration form (English and Russian copy).
- Localized bundle metadata (English, Russian).
- Unit and manifest test suites with `node:test`.
- GitHub Actions CI on Linux and Windows with Node.js 20, 22, and 24.
