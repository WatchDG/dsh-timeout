/**
 * dsh-timeout — pure backoff strategy math.
 *
 * No DSH imports here, so this module is unit-testable in isolation:
 * delay computation (with optional jitter), retryable classification, and a
 * small per-attempt deadline helper (timer + AbortController) that mirrors
 * the semantics of `@deepseek-ai/dsh-timeout` without adding a dependency.
 */

/** Error code used when this plugin's per-attempt deadline wins. */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/**
 * Delay before retry number `attempt` (1-based: the first retry after the
 * initial failure uses `attempt = 1`). Exponential growth is capped at
 * `maxTimeoutMs`. This is the base delay before jitter.
 *
 * @param {number} attempt Completed attempts so far (>= 1).
 * @param {{
 *   minTimeoutMs: number,
 *   maxTimeoutMs: number,
 *   factor: number,
 * }} settings Normalized settings.
 * @returns {number} delay in milliseconds.
 */
export function delayFor(attempt, settings) {
  const n = Number.isInteger(attempt) && attempt >= 1 ? attempt : 1
  const exponential = settings.minTimeoutMs * settings.factor ** (n - 1)
  return Math.max(1, Math.round(Math.min(settings.maxTimeoutMs, exponential)))
}

/**
 * Apply a jitter mode to a base delay.
 *
 * - `none` — fixed delay (no randomization).
 * - `equal` — centered spread: `base × (1 − ratio + 2 × ratio × random)`,
 *   i.e. ±50 % around the base when ratio is 0.5.
 * - `full` — full jitter: uniform `0..base`.
 *
 * @param {number} base Base delay in milliseconds.
 * @param {'none' | 'equal' | 'full'} mode Jitter mode.
 * @param {number} ratio Centered-spread ratio for the `equal` mode.
 * @param {() => number} [random] Random source in [0, 1); Math.random by default.
 * @returns {number} jittered delay (may be fractional).
 */
export function applyJitter(base, mode, ratio, random = Math.random) {
  if (mode === 'none') return base
  if (mode === 'full') return base * random()
  const low = Math.max(0, 1 - ratio)
  const spread = 2 * ratio
  return base * (low + spread * random())
}

/**
 * Full delay for retry number `attempt`, including jitter. Never returns 0,
 * so a retry always waits at least 1 ms even under full jitter with random 0.
 *
 * @param {number} attempt Completed attempts so far (>= 1).
 * @param {{
 *   minTimeoutMs: number,
 *   maxTimeoutMs: number,
 *   factor: number,
 *   jitter: 'none' | 'equal' | 'full',
 *   jitterRatio: number,
 * }} settings Effective per-tool policy.
 * @param {() => number} [random] Random source in [0, 1).
 * @returns {number} delay in milliseconds (>= 1).
 */
export function computeDelay(attempt, settings, random = Math.random) {
  const base = delayFor(attempt, settings)
  return Math.max(1, Math.round(applyJitter(base, settings.jitter, settings.jitterRatio, random)))
}

/**
 * Whether a failed tool result should be retried.
 *
 * A result is retryable when it is an error and its structured code (or the
 * catch-all `"*"`) is in the configured list. Results without a structured
 * code are retried only when `"*"` is configured.
 *
 * @param {unknown} result A `ToolExecutionResult`.
 * @param {{ codes: string[] }} settings Effective policy.
 * @returns {boolean}
 */
export function isRetryable(result, settings) {
  if (result === null || typeof result !== 'object' || result.isError !== true) return false
  if (settings.codes.includes('*')) return true
  const code = result.error?.info?.code
  return typeof code === 'string' && settings.codes.includes(code.toUpperCase())
}

/**
 * Codes that carry no usable taxonomy. The Harness uses `UNKNOWN` for a
 * non-Harness throw; custom adapters (third-party pi-ai bridges) normalize
 * every terminal stream error to `PI_AI_ERROR` instead of classifying it. For
 * these, `failure.message` is the only signal left about what actually failed.
 */
const UNCLASSIFIED_FAILURE_CODES = new Set(['', 'UNKNOWN', 'PI_AI_ERROR'])

/**
 * Quota/billing text that is deliberately NOT transient. Mirrors pi-ai's
 * `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`: retrying a spent subscription
 * only burns the attempt budget.
 */
const NON_RETRYABLE_LIMIT_TEXT =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing|subscription_sharing_usage_limit_exceeded/i

/**
 * Infer a retryable Harness failure code from a provider error message.
 *
 * Mirrors `classifyPiAiError` in DSH's shipped pi-ai adapter, with additions
 * from pi-ai's own `isRetryableAssistantError` wording. Several custom
 * adapters skip classification entirely and emit `PI_AI_ERROR` for every
 * terminal error, including `Connection error.`. Without this, the
 * `TRANSPORT`/`TIMEOUT`/`SERVER` policies never match and the turn fails even
 * with `llmEnabled` on.
 *
 * @param {unknown} message `failure.message`.
 * @returns {string | null} an upper-case code, or null when unrecognizable.
 */
export function classifyFailureMessage(message) {
  if (typeof message !== 'string' || message.length === 0) return null
  if (NON_RETRYABLE_LIMIT_TEXT.test(message)) return null
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) return 'RATE_LIMIT'
  if (/\b(?:400|413)\b|invalid.?request|payload too large|request body too large/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b|overloaded|server_busy|servers are currently busy|currently experiencing high demand|model is at capacity|service.?(?:is.?)?(?:temporarily.?)?unavailable|server.?error|internal.?error/i.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout|timed out|retry delay/i.test(message)) return 'TIMEOUT'
  if (
    /stream ended (?:before|without)\b|ended without|other side closed|HTTP2 request did not get a response|websocket closed unexpectedly|premature close|socket hang up|socket connection was closed|reset before headers/i.test(message) ||
    /\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message) ||
    /\bterminated\b|upstream.?connect|getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(message)
  ) return 'TRANSPORT'
  return null
}

/**
 * Whether a failed model request should be retried.
 *
 * Mirrors `isRetryable` for the `agent/request-error` payload shape:
 * `{ code, message, ... }`. `["*"]` retries any failure. Otherwise the
 * configured codes match `failure.code`; an unclassified code (`PI_AI_ERROR`,
 * `UNKNOWN`, none) is reclassified from `failure.message` first, so a generic
 * `PI_AI_ERROR` "Connection error." still matches a `TRANSPORT` policy.
 *
 * @param {unknown} failure Provider-neutral failure (`failure.code`).
 * @param {{ codes?: string[], llmCodes?: string[] }} policy Effective LLM policy.
 * @returns {boolean}
 */
export function isLlmRetryable(failure, policy) {
  const configured = (policy.llmCodes ?? policy.codes ?? [])
    .filter((code) => typeof code === 'string')
    .map((code) => code.toUpperCase())
  if (configured.includes('*')) return true
  if (failure === null || typeof failure !== 'object') return false
  const raw = failure.code
  const code = typeof raw === 'string' ? raw.toUpperCase() : ''
  if (configured.includes(code)) return true
  // An explicit code always wins; only catch-all codes fall back to the message.
  if (!UNCLASSIFIED_FAILURE_CODES.has(code)) return false
  const inferred = classifyFailureMessage(failure.message)
  return inferred !== null && configured.includes(inferred)
}

/**
 * Stable key for one LLM retry chain: provider + full behavior-affecting policy.
 * Changing limits, codes or backoff starts a fresh chain, like built-in llm-retry.
 *
 * @param {string} provider Provider route name.
 * @param {{ mode: string, maxRetries: number, codes: string[], minTimeoutMs: number, maxTimeoutMs: number, factor: number, jitter: string, jitterRatio: number }} policy Effective LLM policy.
 * @returns {string}
 */
export function llmPolicyKey(provider, policy) {
  return JSON.stringify([
    provider,
    policy.mode,
    policy.maxRetries,
    [...policy.codes].sort(),
    policy.minTimeoutMs,
    policy.maxTimeoutMs,
    policy.factor,
    policy.jitter,
    policy.jitterRatio,
  ])
}

/**
 * Resolve the delay for one model retry: provider `Retry-After` when valid
 * and within the ceiling, otherwise local exponential backoff with jitter.
 *
 * @param {number} retry 1-based retry number.
 * @param {{ minTimeoutMs: number, maxTimeoutMs: number, factor: number, jitter: string, jitterRatio: number }} policy Effective LLM policy.
 * @param {unknown} failure Provider failure (may carry `providerRetryAfterMs`).
 * @param {() => number} [random] Random source in [0,1).
 * @returns {{ delayMs: number, remote: boolean }}
 */
export function resolveLlmDelay(retry, policy, failure, random = Math.random) {
  const retryAfter =
    failure !== null && typeof failure === 'object' ? failure.providerRetryAfterMs : undefined
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= policy.maxTimeoutMs) {
    return { delayMs: Math.max(1, Math.round(retryAfter)), remote: true }
  }
  // Reuse the tool backoff math: min * factor^(retry-1), capped, jittered.
  const base = delayFor(retry, policy)
  const jittered = Math.max(1, Math.round(applyJitter(base, policy.jitter, policy.jitterRatio, random)))
  return { delayMs: jittered, remote: false }
}

/**
 * A cancellable delay. Resolves `true` when the full delay elapsed, `false`
 * when the signal aborted first.
 *
 * @param {number} delayMs Delay in milliseconds.
 * @param {AbortSignal} signal Cancellation.
 * @returns {Promise<boolean>}
 */
export function cancellableDelay(delayMs, signal) {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Arm a per-attempt deadline. `deadline.signal` is the downstream signal the
 * tool body sees; it aborts when the deadline elapses (with `reason` set to
 * `{ code }`) or when the upstream signal aborts. `deadline.fired` is true
 * only when this deadline itself won, not when the caller cancelled.
 *
 * @param {AbortSignal} upstream The caller signal.
 * @param {number} timeoutMs Elapsed budget in milliseconds.
 * @param {string} [code] Error code carried in the abort reason.
 * @returns {{
 *   signal: AbortSignal,
 *   get fired(): boolean,
 *   dispose(): void,
 * }}
 */
export function makeDeadline(upstream, timeoutMs, code = TOOL_TIMEOUT) {
  const controller = new AbortController()
  let fired = false
  let timer
  const cleanup = () => {
    upstream.removeEventListener('abort', onUpstreamAbort)
    if (timer !== undefined) clearTimeout(timer)
  }
  const onUpstreamAbort = () => {
    controller.abort(upstream.reason)
    cleanup()
  }
  const onFired = () => {
    if (controller.signal.aborted) return
    fired = true
    controller.abort(Object.assign(new Error(`deadline ${code}`), { code }))
    cleanup()
  }
  timer = setTimeout(onFired, timeoutMs)
  if (upstream.aborted) onUpstreamAbort()
  else upstream.addEventListener('abort', onUpstreamAbort, { once: true })
  return {
    signal: controller.signal,
    get fired() {
      return fired
    },
    dispose: cleanup,
  }
}

/**
 * The structured failure result substituted when this plugin's per-attempt
 * deadline wins. `error.code` is `TOOL_TIMEOUT`, so the configured retry list
 * treats it like any other deadline expiry.
 *
 * @param {number} timeoutMs The elapsed budget, rendered into the message.
 * @returns {object} an `isError` tool result.
 */
export function toolTimeoutResult(timeoutMs) {
  const message = `tool call timed out after ${timeoutMs}ms`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: {
      message,
      info: { name: 'ToolTimeoutError', code: TOOL_TIMEOUT },
    },
  }
}
