# dsh-timeout

[![CI](https://github.com/WatchDG/dsh-timeout/actions/workflows/ci.yml/badge.svg)](https://github.com/WatchDG/dsh-timeout/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**English** | [Русский](README.ru.md)

Exponential backoff retry strategy for [DeepSeek Harness](https://www.deepseek.com/en/harness/)
tool calls. DSH dispatches a tool call once: when it fails — or hits its
deadline — the error goes straight to the model, and the model has to re-issue
the call by hand. This plugin wraps the `tools/execute` waterfall and retries
configured failures with a configurable exponential backoff:

```
delay = min(maxTimeoutMs, minTimeoutMs × factor^(attempt − 1))
```

until the call succeeds, the attempt budget is exhausted, or the caller
cancels. It replaces the built-in single-shot timeout behavior with a strategy
you control — no restart needed, settings are live-editable.

## Requirements

| Requirement | Details |
|---|---|
| [DeepSeek Harness](https://www.deepseek.com/en/harness/) | 0.2.2-RC.1 (tested; also 0.2.1-RC.5). The plugin uses the Host `tools` service and the `tools/execute` event. |
| Node.js | 24.9 or newer; DSH 0.2.2 raises the runtime floor to Node.js 24.9. |

No external binaries, no build step.

## Installation in DeepSeek Harness

The plugin is a bundle for the current DSH profile, so it applies to every
session of that profile.

1. Open the **Plugins** page in the DSH sidebar (the Plugin Manager).
2. Choose **Add plugin** / **Install bundle**, select this directory (the one
   containing `package.json`), and confirm.
3. Make sure **Exponential Backoff Retry** / **Экспоненциальный бэкoфф** is
   enabled in the plugin list.

The same step is available to an agent through the `plugin_manager` tool with
`action: install_bundle` and the absolute path to this directory. DSH records a
`link:` dependency on the directory in the profile's `package.json`; because the
directory is linked, restart DSH after updating the plugin's files so Host
JavaScript is loaded again.

To uninstall, remove the bundle from the Plugin Manager (or
`plugin_manager` `action: remove_bundle`).

## What the plugin does

### Retry loop with exponential backoff

A listener on `tools/execute` runs the call and retries configured failures for
the same call identity (same name, arguments, agent, signal). Attempt 1 calls
the waterfall's `next()` exactly once and runs the rest of the chain. DSH 0.2.2
ships Cordis 4.1.0, where `next()` is single-use — a second call throws
`next() called multiple times` — so a retry bypasses the waterfall and re-runs
the tool body directly through the resolved `ToolDefinition`
(`ctx.tools.executable(name, agent, exec.toolSet)`, with a
`ctx.tools.get(name, agent)` fallback); the registry re-normalizes the raw
value through the tool's output contract. Retried attempts therefore keep the
original call identity, the single `tools/pre-execute` gate and its approvals
run once, and the single `tools/post-execute` / `tools/result` pass still
happens once, after the wrapper returns. Each failed, retryable attempt is
followed by a wait of `minTimeoutMs × factor^(attempt − 1)`, capped at
`maxTimeoutMs`, before the next attempt.

Behavior details:

- **Attempts** — `maxAttempts` total attempts per call (default 3), or
  unlimited when the `unlimited` flag is on. The wait grows up to
  `maxTimeoutMs`, so an always-failing call keeps pinging at the ceiling.
- **What is retried** — only failed results whose structured error code is in
  `codes` (default `TOOL_TIMEOUT`). The catch-all `*` retries any failure. A
  call without a structured code is never retried unless `*` is configured.
- **Jitter** — retry delays are randomized to spread parallel calls (DSH
  runs up to several sub-calls concurrently): `none` keeps the fixed
  exponential schedule, `equal` (default) spreads ±`jitterRatio` around the
  base, `full` draws uniformly from `0..base`.
- **Per-tool overrides** — `toolOverrides` lets you override any retry
  setting per tool; unset fields inherit the global values.
- **Cancellation wins** — if the caller signal aborts during a wait, the
  retry stops and the last failure is returned. A call whose caller already
  aborted is never retried.
- **Exhaustion** — when the budget runs out, the final (last) failure is
  returned unchanged, so the model sees the genuine error.
- **No re-approval** — pre-execution checks, guards, and approvals run once,
  before the loop; `tools/post-execute` and `tools/result` run once, after it.
- **Durable session events** — every scheduled retry appends `tool/retry`
  (`callId`, `tool`, `attempt`, `code`, `delayMs`) and `tool/retry-started`
  to the session log, so retries are visible in the session history and can be
  analyzed per session.

### Per-attempt deadlines

DSH's built-in timeout enforcement is a separate package that this profile may
or may not compose; tools declare `timeoutMs` regardless. With `armTimeout`
(default on), this plugin arms the declared deadline **per attempt**: each
attempt gets its own budget, and a hung call becomes a retryable
`TOOL_TIMEOUT` instead of a stuck dispatch. This is what makes retries useful
for genuinely slow or momentarily unavailable work.

### Settings page

**Settings → Backoff** shows:

- **Live counters** — tool attempts, tool retries, tool deadline hits and their
  last code, plus model attempts, model retries and the last model code, since
  the Host loaded the plugin (`GET /backoff/status`). The counters re-read the
  route while the section is open, so retries that happen after it was opened
  show up without pressing **Refresh**.
- **Per-session activity** — the same tool *and* model counters broken down by
  session, top activity first.
- **Behavior** — the configuration below, editable in place with no restart via
  volatile fields, including jitter and per-tool overrides.

## Configuration

Every field is optional. Override the `backoff` row in the profile's patch layer,
or edit it live on the **Settings → Backoff** page.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch; off = single dispatch, exactly like default DSH. |
| `maxAttempts` | number | `3` | Total attempts per call (including the first). Ignored when `unlimited` is on. |
| `unlimited` | boolean | `false` | Retry forever until success or caller interruption. |
| `minTimeoutMs` | number | `1000` | First retry delay in ms. |
| `maxTimeoutMs` | number | `60000` | Delay ceiling in ms; a value below `minTimeoutMs` is raised to it. |
| `factor` | number | `2` | Delay growth factor per retry (must be > 1). |
| `codes` | string[] | `['TOOL_TIMEOUT']` | Error codes that trigger a retry; `["*"]` = any failure. |
| `tools` | string[] | `[]` | Tool names to cover; empty = all tools. |
| `armTimeout` | boolean | `true` | Enforce each tool's declared `timeoutMs` as a per-attempt deadline. |
| `jitter` | `'none' \| 'equal' \| 'full'` | `'equal'` | Delay randomization: fixed, ±ratio centered, or uniform 0..base. |
| `jitterRatio` | number | `0.5` | Spread for `equal` jitter (±50 %). |
| `toolOverrides` | object | `{}` | Per-tool partial overrides; unset fields inherit globals. |
| `llmEnabled` | boolean | `false` | Retry model requests (`Retried model request` in chat). |
| `llmUnlimited` | boolean | `false` | Unlimited model retries (`retry/∞`). |
| `llmMaxRetries` | number | `10` | Model retries after first failure. Ignored when `llmUnlimited`. |
| `llmMinTimeoutMs` | number | `1000` | First model retry delay. |
| `llmMaxTimeoutMs` | number | `30000` | Model delay ceiling; provider `Retry-After` within it wins. |
| `llmFactor` | number | `2` | Model delay growth factor. |
| `llmCodes` | string[] | `[EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT]` | Model codes to retry; `["*"]` = any. |
| `llmJitter` | `'none' \| 'equal' \| 'full'` | `'equal'` | Model delay randomization. |
| `llmJitterRatio` | number | `0.2` | Spread for model `equal` jitter (±20 %). |

```yaml
- id: backoff
  config:
    enabled: true
    maxAttempts: 5          # up to 5 attempts per call
    unlimited: false
    minTimeoutMs: 500       # first retry after 0.5 s
    maxTimeoutMs: 30000     # never wait longer than 30 s
    factor: 2               # 0.5s → 1s → 2s → 4s → …
    codes: [TOOL_TIMEOUT]  # retry deadline hits only
    tools: [pwsh, bash]     # shell tools only
    armTimeout: true
    jitter: equal           # ±50% around the base (jitterRatio 0.5)
    jitterRatio: 0.5
    toolOverrides:          # per-tool overrides
      pwsh:
        maxAttempts: 3      # fewer attempts for shells
        codes: [TOOL_TIMEOUT, COMMAND_FAILED]
      web_fetch:
        unlimited: true     # retry web fetches until success
    llmEnabled: true        # retry Connection error (TRANSPORT) etc.
    llmMaxRetries: 10
    llmUnlimited: false     # true = retry/∞ until success or interrupt
    llmMinTimeoutMs: 1000
    llmMaxTimeoutMs: 30000
    llmCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]
```

### Model requests (`Retried model request`)

Tools and models are fully independent, each on its own: tools via
`enabled/maxAttempts/unlimited/...`, models via
`llmEnabled/llmMaxRetries/llmUnlimited/...`. Turning tools off does not
stop model retries and vice versa.

`Retried model request (retry/maximum)` is the built-in `dsh-llm-retry`
executor plus each provider's `retryPolicy` (default: 5 retries for
`EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT`). DSH's shipped pi-ai
adapter classifies `Connection error` as `TRANSPORT`, so 5 retries then
`This turn failed` is the expected default there.

Custom pi-ai adapters (for example `dsh-opencode`) often skip that
classification and emit the catch-all `PI_AI_ERROR` for every terminal stream
error — `Connection error. / PI_AI_ERROR` included — and a thrown non-Harness
network error arrives as `UNKNOWN`. Neither code is in the default policy, so
without this plugin's reclassification the turn fails after the very first
attempt even with `llmEnabled` on. The plugin now infers the code from
`failure.message` for these unclassified failures, so `Connection error.` is
retried as `TRANSPORT`, `HTTP 503` as `SERVER`, `timed out` as `TIMEOUT`, and
so on; explicit codes always win, and quota/billing text stays non-retryable.
When the built-in executor is disabled (as in the profile above), this plugin
is the only recovery path.

This plugin adds its own `agent/request-error` listener when `llmEnabled`
is on, emitting the same `llm/retry` events so chat renders identically
(`retry/∞` when `llmUnlimited`). Its retry-chain bookkeeping is process-local,
per session, and resets on a new turn/step (an exhausted budget never silences
later failures); only the `llm/retry` / `llm/retry-started` events are durable
in the session log. Totals add up when both executors are on (built-in + this
plugin); to count from this plugin only, disable the built-in route:

```yaml
- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        retryPolicy: { mode: normal, maxRetries: 0 }
```

## Safety notes

- Retried attempts rerun the **same call with the same arguments**. For tools
  with side effects (file writes, network mutations), decide carefully whether
  re-execution is safe; restrict `codes`/`tools`, or raise `maxAttempts` only
  where it is.
- The default retries **only deadline hits** (`TOOL_TIMEOUT`), which are the
  classic case where a retry is harmless.
- The plugin performs no network access and spawns no processes; it only
  orchestrates the existing tool execution pipeline. The Settings page talks to
  the Host's own authenticated `/backoff/status` route.

## Verification

1. The **Plugins** page shows **Exponential Backoff Retry** and it is enabled.
2. **Settings → Backoff** shows live counters and an editable form.
3. In a session, run a command that hangs longer than the tool's `timeoutMs`
   (or a deliberately failing call with `codes: ["*"]`): the log and the
   counters show retries, and the final result arrives after the configured
   backoff pattern.
4. Check that a cancelled call stops retrying immediately.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Nothing retries | The plugin is disabled, the tool is not in `tools`, or the failure's code is not in `codes`. |
| `Connection error / PI_AI_ERROR` fails the turn with no retries | A custom adapter emitted an unclassified code. The plugin now infers the code from the message; if the message carries no recognizable wording, add `PI_AI_ERROR` (or `UNKNOWN`) to `llmCodes`, or use `["*"]`. |
| A hung call still hangs | `armTimeout` is off, or the tool declares no `timeoutMs` (nothing to arm). |
| Too many retries | Lower `maxAttempts`, remove `*` from `codes`, or enable `unlimited` only deliberately. |
| Settings page shows “not served” | The profile stores settings read-only, or the row id changed from `backoff`. |

## Development

One dependency (`@deepseek-ai/schemastery` for the settings schema) and no
build step.

```bash
npm install            # install dependencies (settings schema + Cordis for the contract tests)
npm test               # unit tests + contract tests + manifest checks
npm run test:unit      # same suites
npm run pack:check     # verify the npm package contents
```

Layout:

```
index.js              Host entry point: exports apply / name / inject / Config
client.js             Settings → Backoff page: counters + editable behavior form (web client)
lib/config.js         Config schema, defaults, normalization, volatile snapshot
lib/backoff.js        pure strategy math: delays, retryable classification, deadline helper
lib/plugin.js         context wiring (settings namespace + tools/execute retry loop + status route)
test/                 node:test suites (config, backoff, llm, plugin, client, contract, manifest)
```

When adding a runtime module, add it to `files` in `package.json`; the manifest
test fails otherwise. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Links

- **DeepSeek Harness** — https://www.deepseek.com/en/harness/
- **Plugin repository** — https://github.com/WatchDG/dsh-timeout

## License

[Apache-2.0](LICENSE), © 2026 Baranov Grigoriy Vladimirovich.
