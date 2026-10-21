/**
 * dsh-timeout — plugin mounting.
 *
 * Kept separate from `index.js` so the wiring can be unit-tested with a fake
 * plugin context, without a running Harness.
 *
 * Config is read live: `snapshot()` unwraps volatile references on every use,
 * so the Settings page can flip any field without remounting the plugin.
 *
 * Two independent waterfalls:
 * - `tools/execute`: gated only by `enabled`. Inside one dispatch the wrapper
 *   may call `next()` more than once — each call re-runs the tool body for
 *   the same call identity. `tools/pre-execute` and the guards run once,
 *   before this waterfall; the post-execute and `tools/result` stages run
 *   once, after it. Retried attempts therefore do not re-trigger approvals
 *   or duplicate final reports.
 * - `agent/request-error`: gated only by `llmEnabled` (tools `enabled` does
 *   not affect it). Each failed step arrives once; returning `{ kind: "retry" }`
 *   re-runs the failed step in the same open turn. Events are `llm/retry` /
 *   `llm/retry-started` so the chat UI renders the same
 *   `Retried model request (retry/maximum)` rows as the built-in llm-retry
 *   executor. `llmUnlimited` maps to `mode: "always"` (`retry/∞`).
 */

import { policyFor, snapshot } from './config.js'
import {
  TOOL_TIMEOUT,
  cancellableDelay,
  computeDelay,
  isRetryable,
  makeDeadline,
  toolTimeoutResult,
} from './backoff.js'
import { LLM_PROJECTION_KEY, createRecoverWithBackoff, ensureLlmStats } from './llm.js'

/** Authenticated HTTP route the Settings page reads live counters from. */
export const STATUS_PATH = '/backoff/status'

/** Event type appended to the session log when a retry is scheduled. */
export const RETRY_EVENT = 'tool/retry'

/** Event type appended to the session log when a scheduled retry starts. */
export const RETRY_STARTED_EVENT = 'tool/retry-started'

/** Build an empty counters record (tools + model requests). */
function zeroStats() {
  return { attempts: 0, retries: 0, timeouts: 0, lastCode: null, llmAttempts: 0, llmRetries: 0, llmLastCode: null }
}

/**
 * Build the retry-loop executor. Extracted from `mount` so tests can drive it
 * with a fake `next()` and a fake clock.
 *
 * @param {{
 *   readSettings: () => ReturnType<typeof snapshot>,
 *   getToolTimeoutMs?: (exec: { name: string, agent?: unknown }) => number | undefined,
 *   delay?: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   random?: () => number,
 *   stats: { attempts: number, retries: number, timeouts: number, lastCode: string | null },
 *   sessions?: Map<string, object>,
 * }} deps
 * @returns {(exec: { name: string, signal: AbortSignal, agent?: unknown }, next: () => Promise<object>) => Promise<object>}
 */
export function createExecuteWithBackoff({ readSettings, getToolTimeoutMs, delay, random, stats, sessions }) {
  const wait = delay ?? cancellableDelay
  const nextRandom = random ?? Math.random

  /** Increment one numeric counter on the global record and, when known, the session record. */
  const count = (exec, field) => {
    stats[field] += 1
    const agent = exec?.agent
    if (agent && typeof agent === 'object' && sessions && agent.id !== undefined) {
      const sid = agent.id
      let record = sessions.get(sid)
      if (!record) sessions.set(sid, record = zeroStats())
      record[field] += 1
    }
  }
  /** Remember the last error code on both records. */
  const markLast = (exec, code) => {
    stats.lastCode = code
    const agent = exec?.agent
    if (agent && typeof agent === 'object' && sessions && agent.id !== undefined) {
      const sid = agent.id
      let record = sessions.get(sid)
      if (!record) sessions.set(sid, record = zeroStats())
      record.lastCode = code
    }
  }

  /** Append a durable event to the owning session log, when available. */
  const appendEvent = (exec, type, data) => {
    const agent = exec?.agent
    if (agent && typeof agent === 'object' && agent.session && typeof agent.session.append === 'function') {
      try {
        agent.session.append(type, data)
      } catch {
        // Logging must never break the retry loop.
      }
    }
  }

  return async function executeWithBackoff(exec, next) {
    const settings = readSettings()
    if (!settings.enabled) return next()
    if (settings.tools.size > 0 && !settings.tools.has(exec.name)) return next()

    // Effective per-tool policy: global values with toolOverrides on top.
    const policy = policyFor(settings, exec.name)

    const declaredTimeout = getToolTimeoutMs?.(exec)
    const armBudget = policy.armTimeout && typeof declaredTimeout === 'number' && Number.isFinite(declaredTimeout) && declaredTimeout > 0

    let attempt = 0
    for (;;) {
      attempt += 1
      count(exec, 'attempts')

      /** @type {object} */
      let result
      if (armBudget) {
        const upstream = exec.signal
        const deadline = makeDeadline(upstream, declaredTimeout, TOOL_TIMEOUT)
        exec.signal = deadline.signal
        try {
          result = await next()
          if (deadline.fired && !upstream.aborted) {
            count(exec, 'timeouts')
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
      markLast(exec, code)

      // Caller cancellation wins over any retry policy.
      if (exec.signal.aborted) return result
      if (!isRetryable(result, policy)) return result
      if (!policy.unlimited && attempt >= policy.maxAttempts) return result

      count(exec, 'retries')
      const delayMs = computeDelay(attempt, policy, nextRandom)
      appendEvent(exec, RETRY_EVENT, {
        callId: exec.callId,
        rootCallId: exec.rootCallId,
        tool: exec.name,
        attempt,
        code,
        delayMs,
      })
      if (!(await wait(delayMs, exec.signal))) return result
      appendEvent(exec, RETRY_STARTED_EVENT, {
        callId: exec.callId,
        rootCallId: exec.rootCallId,
        tool: exec.name,
        attempt,
      })
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
 * @param {{
 *   delay?: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   random?: () => number,
 * }} [internals]
 */
export function mount(ctx, rawConfig, internals = {}) {
  /** Live snapshot: the Settings page may replace a field at any moment. */
  const readSettings = () => snapshot(rawConfig)

  /** Live counters served over the status channel. */
  const stats = zeroStats()
  ensureLlmStats(stats)

  /** Per-session counters, keyed by session id. */
  const sessions = new Map()

  const executeWithBackoff = createExecuteWithBackoff({
    readSettings,
    getToolTimeoutMs: (exec) => ctx.tools?.get?.(exec.name, exec.agent)?.timeoutMs,
    delay: internals.delay,
    random: internals.random,
    stats,
    sessions,
  })

  ctx.on('tools/execute', (exec, next) => executeWithBackoff(exec, next))

  // LLM retry counters: in-memory per session + best-effort Host projection read.
  // No custom projection registration here on purpose: Host validates
  // projection schemas strictly, and a rejected registration must never take
  // the whole bundle (and its Settings page) down. The built-in llm-retry
  // projection already gives durability for its own chain; ours tracks our
  // own policyKey in memory, which is enough for backoff counting.
  const llmMemory = new Map()
  const memKeyFor = (session) => session?.id ?? session ?? 'global'
  const getLlmState = (session) => {
    let fromHost = {}
    try {
      if (ctx.sessionProjections && session && typeof ctx.sessionProjections.stateOf === 'function') {
        fromHost = ctx.sessionProjections.stateOf(session, LLM_PROJECTION_KEY) ?? {}
      }
    } catch {
      fromHost = {}
    }
    const mem = llmMemory.get(memKeyFor(session))
    if (!mem) return fromHost
    return { ...fromHost, ...mem }
  }

  const recoverWithBackoff = createRecoverWithBackoff({
    readSettings,
    delay: internals.delay,
    random: internals.random,
    stats,
    sessions,
    getState: getLlmState,
    onScheduled: (session, policyKey, entry) => {
      const k = memKeyFor(session)
      const prev = llmMemory.get(k) ?? {}
      llmMemory.set(k, { ...prev, [policyKey]: entry })
    },
  })

  // Track active LLM recoveries so disposal drains them like built-in llm-retry.
  const llmActive = new Set()
  const trackLlm = (operation) => {
    const tracked = operation.finally(() => llmActive.delete(tracked))
    llmActive.add(tracked)
    return tracked
  }
  ctx.on('agent/request-error', (payload, next) => trackLlm(recoverWithBackoff(payload, next)))

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
              json(res, 200, statusView(readSettings(), stats, sessions))
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
 * @param {ReturnType<typeof zeroStats>} stats Live counters.
 * @param {Map<string, ReturnType<typeof zeroStats>>} [sessions] Per-session counters.
 */
export function statusView(settings, stats, sessions) {
  const sessionRows = []
  if (sessions) {
    for (const [sessionId, record] of sessions) {
      ensureLlmStats(record)
      sessionRows.push({
        sessionId,
        attempts: record.attempts,
        retries: record.retries,
        timeouts: record.timeouts,
        lastCode: record.lastCode,
        llmAttempts: record.llmAttempts,
        llmRetries: record.llmRetries,
        llmLastCode: record.llmLastCode,
      })
    }
    sessionRows.sort((a, b) => (b.attempts + (b.llmAttempts ?? 0)) - (a.attempts + (a.llmAttempts ?? 0)))
  }
  ensureLlmStats(stats)
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
      jitter: settings.jitter,
      jitterRatio: settings.jitterRatio,
      toolOverrides: settings.toolOverrides,
      llmEnabled: settings.llmEnabled,
      llmUnlimited: settings.llmUnlimited,
      llmMaxRetries: settings.llmMaxRetries,
      llmMinTimeoutMs: settings.llmMinTimeoutMs,
      llmMaxTimeoutMs: settings.llmMaxTimeoutMs,
      llmFactor: settings.llmFactor,
      llmCodes: [...settings.llmCodes],
      llmJitter: settings.llmJitter,
      llmJitterRatio: settings.llmJitterRatio,
    },
    stats: {
      attempts: stats.attempts,
      retries: stats.retries,
      timeouts: stats.timeouts,
      lastCode: stats.lastCode,
      llmAttempts: stats.llmAttempts,
      llmRetries: stats.llmRetries,
      llmLastCode: stats.llmLastCode,
    },
    sessions: sessionRows,
  }
}

export { normalizeConfig } from './config.js'
