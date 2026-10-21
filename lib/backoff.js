/**
 * dsh-timeout — pure backoff strategy math.
 *
 * No DSH imports here, so this module is unit-testable in isolation:
 * delay computation, retryable classification, and a small per-attempt
 * deadline helper (timer + AbortController) that mirrors the semantics of
 * `@deepseek-ai/dsh-timeout` without adding a dependency.
 */

/** Error code used when this plugin's per-attempt deadline wins. */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/**
 * Delay before retry number `attempt` (1-based: the first retry after the
 * initial failure uses `attempt = 1`). Exponential growth is capped at
 * `maxTimeoutMs`.
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
 * Whether a failed tool result should be retried.
 *
 * A result is retryable when it is an error and its structured code (or the
 * catch-all `"*"`) is in the configured list. Results without a structured
 * code are retried only when `"*"` is configured.
 *
 * @param {unknown} result A `ToolExecutionResult`.
 * @param {{ codes: string[] }} settings Normalized settings.
 * @returns {boolean}
 */
export function isRetryable(result, settings) {
  if (result === null || typeof result !== 'object' || result.isError !== true) return false
  if (settings.codes.includes('*')) return true
  const code = result.error?.info?.code
  return typeof code === 'string' && settings.codes.includes(code.toUpperCase())
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
