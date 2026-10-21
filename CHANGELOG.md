# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
