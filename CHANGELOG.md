# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
