/**
 * dsh-timeout — plugin mounting.
 *
 * Kept separate from `index.js` so the wiring can be unit-tested with a fake
 * plugin context, without a running Harness.
 *
 * Config is read live: `snapshot()` unwraps volatile references on every use,
 * so the Settings page can flip any field without remounting the plugin.
 *
 * The retry loop runs on the `tools/execute` waterfall: inside one dispatch,
 * the wrapper may call `next()` more than once — each call re-runs the tool
 * body for the same call identity (same name, arguments, agent, signal).
 * `tools/pre-execute` and the guards run once, before this waterfall; the
 * post-execute and `tools/result` stages run once, after it. Retried attempts
 * therefore do not re-trigger approvals or duplicate final reports.
 */

import { snapshot } from './config.js'
import {
  TOOL_TIMEOUT,
  cancellableDelay,
  delayFor,
  isRetryable,
  makeDeadline,
  toolTimeoutResult,
} from './backoff.js'

/** Authenticated HTTP route the Settings page reads live counters from. */
export const STATUS_PATH = '/backoff/status'

/**
 * Build the retry-loop executor. Extracted from `mount` so tests can drive it
 * with a fake `next()` and a fake clock.
 *
 * @param {{
 *   readSettings: () => ReturnType<typeof snapshot>,
 *   getToolTimeoutMs?: (exec: { name: string, agent?: unknown }) => number | undefined,
 *   delay?: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   stats: { attempts: number, retries: number, timeouts: number, lastCode: string | null },
 * }} deps
 * @returns {(exec: { name: string, signal: AbortSignal }, next: () => Promise<object>) => Promise<object>}
 */
export function createExecuteWithBackoff({ readSettings, getToolTimeoutMs, delay, stats }) {
  const wait = delay ?? cancellableDelay

  return async function executeWithBackoff(exec, next) {
    const settings = readSettings()
    if (!settings.enabled) return next()
    if (settings.tools.size > 0 && !settings.tools.has(exec.name)) return next()

    const declaredTimeout = getToolTimeoutMs?.(exec)
    const armBudget = settings.armTimeout && typeof declaredTimeout === 'number' && Number.isFinite(declaredTimeout) && declaredTimeout > 0

    let attempt = 0
    for (;;) {
      attempt += 1
      stats.attempts += 1

      /** @type {object} */
      let result
      if (armBudget) {
        const upstream = exec.signal
        const deadline = makeDeadline(upstream, declaredTimeout, TOOL_TIMEOUT)
        exec.signal = deadline.signal
        try {
          result = await next()
          if (deadline.fired && !upstream.aborted) {
            stats.timeouts += 1
            result = toolTimeoutResult(declaredTimeout)
          }
        } catch (error) {
          result = errorResult(error)
        } finally {
          exec.signal = upstream
          deadline.dispose()
        }
      } else {
        try {
          result = await next()
        } catch (error) {
          result = errorResult(error)
        }
      }

      if (!result.isError) return result

      const code = typeof result.error?.info?.code === 'string' ? result.error.info.code : null
      stats.lastCode = code

      // Caller cancellation wins over any retry policy.
      if (exec.signal.aborted) return result
      if (!isRetryable(result, settings)) return result
      if (!settings.unlimited && attempt >= settings.maxAttempts) return result

      stats.retries += 1
      const delayMs = delayFor(attempt, settings)
      if (!(await wait(delayMs, exec.signal))) return result
    }
  }
}

/** Build a structured failure view from a thrown error (no structured code). */
function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message },
  }
}

/**
 * Register the settings namespace, the `tools/execute` retry wrapper, and the
 * status route.
 *
 * @param {object} ctx Plugin context supplied by the DSH loader.
 * @param {unknown} rawConfig Bundle row config, possibly with volatile references.
 * @param {{ delay?: (ms: number, signal: AbortSignal) => Promise<boolean> }} [internals]
 */
export function mount(ctx, rawConfig, internals = {}) {
  /** Live snapshot: the Settings page may replace a field at any moment. */
  const readSettings = () => snapshot(rawConfig)

  /** Live counters served over the status channel. */
  const stats = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }

  const executeWithBackoff = createExecuteWithBackoff({
    readSettings,
    getToolTimeoutMs: (exec) => ctx.tools?.get?.(exec.name, exec.agent)?.timeoutMs,
    delay: internals.delay,
    stats,
  })

  ctx.on('tools/execute', (exec, next) => executeWithBackoff(exec, next))

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (child) => {
      if (ctx.fiber === undefined) return
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-timeout: own settings page')
    })

    ctx.inject(['webServer', 'connection'], (child) => {
      child.effect(
        () =>
          child.webServer.register({
            kind: 'exact',
            path: STATUS_PATH,
            handler: async (req, res) => {
              if (gate(child, req, res, ['GET'])) return
              json(res, 200, statusView(readSettings(), stats))
            },
          }),
        'dsh-timeout: GET /backoff/status',
      )
    })
  }
}

/**
 * Shared gate for the settings routes: browser-trust rejection, then method.
 *
 * @returns {boolean} true when the request was answered here.
 */
function gate(child, req, res, methods) {
  const rejection = child.connection.requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return true
  }
  if (!methods.includes(req.method)) {
    res.statusCode = 405
    res.setHeader('allow', methods.join(', '))
    res.end()
    return true
  }
  return false
}

/** Send a JSON payload with no-store caching. */
function json(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Payload the Settings page reads over the status channel.
 *
 * @param {ReturnType<typeof snapshot>} settings Normalized settings.
 * @param {typeof stats} stats Live counters.
 */
export function statusView(settings, stats) {
  return {
    enabled: settings.enabled,
    settings: {
      maxAttempts: settings.maxAttempts,
      unlimited: settings.unlimited,
      minTimeoutMs: settings.minTimeoutMs,
      maxTimeoutMs: settings.maxTimeoutMs,
      factor: settings.factor,
      codes: [...settings.codes],
      tools: [...settings.tools],
      armTimeout: settings.armTimeout,
    },
    stats: {
      attempts: stats.attempts,
      retries: stats.retries,
      timeouts: stats.timeouts,
      lastCode: stats.lastCode,
    },
  }
}

export { normalizeConfig } from './config.js'
