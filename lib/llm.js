/**
 * dsh-timeout — model-request retry executor.
 *
 * Mirrors `@deepseek-ai/dsh-llm-retry` execution semantics so the chat UI
 * renders the same `Retried model request (retry/maximum)` rows, but driven
 * by this plugin's `llm*` settings (count or unlimited) instead of each
 * provider's `retryPolicy`.
 *
 * When `llmEnabled` is on, mount a listener on `agent/request-error`:
 * - eligible failure codes (`llmCodes`, `["*"]` = any) are retried with
 *   `delay = min(llmMaxTimeoutMs, llmMinTimeoutMs * llmFactor^(retry-1))`
 *   plus jitter, or provider `Retry-After` when valid and within the ceiling;
 * - each scheduled retry appends durable `llm/retry` before the cancellable
 *   wait and `llm/retry-started` right after, so the session log stays
 *   consistent across cancellation and restarts;
 * - `llmUnlimited` maps to `mode: "always"` (`retry/∞` in the UI) and keeps
 *   retrying until success or interruption; otherwise `llmMaxRetries` bounds
 *   the chain (`retry/maxRetries`).
 *
 * To get exact counts from this plugin, disable the built-in executor for the
 * route (provider `retryPolicy: { mode: "normal", maxRetries: 0, ... }`):
 * otherwise the built-in 5 retries run first and this plugin adds its own on
 * top (total = built-in + plugin), shown as two chains.
 */

import { randomUUID } from 'node:crypto'

import { policyForLlm } from './config.js'
import {
  cancellableDelay,
  isLlmRetryable,
  llmPolicyKey,
  resolveLlmDelay,
} from './backoff.js'

/** Session event the chat UI renders as `Retried model request`. */
export const LLM_RETRY_EVENT = 'llm/retry'

/** Session event marking the end of the backoff wait. */
export const LLM_RETRY_STARTED_EVENT = 'llm/retry-started'

/** Projection key for this plugin's durable retry counters. */
export const LLM_PROJECTION_KEY = 'backoffLlmRetry'

/** Ensure LLM counters exist on a (possibly legacy) stats record. */
export function ensureLlmStats(record) {
  if (typeof record.llmAttempts !== 'number') record.llmAttempts = 0
  if (typeof record.llmRetries !== 'number') record.llmRetries = 0
  if (!('llmLastCode' in record)) record.llmLastCode = null
  return record
}

/**
 * Build the `agent/request-error` recovery listener.
 *
 * @param {{
 *   readSettings: () => { enabled: boolean, llmEnabled: boolean, [k: string]: unknown },
 *   delay?: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   random?: () => number,
 *   stats: { llmAttempts?: number, llmRetries?: number, llmLastCode?: string | null, [k: string]: unknown },
 *   sessions?: Map<string, object>,
 *   getState?: (session: object) => Record<string, { retry: number, retryId: string }>,
 *   onScheduled?: (session: object, policyKey: string, entry: { retry: number, retryId: string }) => void,
 * }} deps
 */
export function createRecoverWithBackoff({ readSettings, delay, random, stats, sessions, getState, onScheduled }) {
  const wait = delay ?? cancellableDelay
  const nextRandom = random ?? Math.random
  ensureLlmStats(stats)

  const count = (agent, field) => {
    stats[field] += 1
    const sid = agent?.id
    if (agent && typeof agent === 'object' && sid !== undefined && sessions) {
      let record = sessions.get(sid)
      if (!record) {
        record = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }
        sessions.set(sid, record)
      }
      ensureLlmStats(record)
      record[field] += 1
    }
  }

  const markLast = (agent, code) => {
    stats.llmLastCode = code
    const sid = agent?.id
    if (agent && typeof agent === 'object' && sid !== undefined && sessions) {
      let record = sessions.get(sid)
      if (!record) {
        record = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }
        sessions.set(sid, record)
      }
      ensureLlmStats(record)
      record.llmLastCode = code
    }
  }

  const appendEvent = (agent, type, data) => {
    if (agent && typeof agent === 'object' && agent.session && typeof agent.session.append === 'function') {
      try {
        agent.session.append(type, data)
      } catch {
        // Logging must never break recovery.
      }
    }
  }

  return async function recoverWithBackoff(payload, next) {
    const settings = readSettings()
    // Independent master switch: tools `enabled` does NOT gate model retries.
    // Each side is configured on its own: tools via enabled/maxAttempts/...,
    // models via llmEnabled/llmMaxRetries/... .
    if (!settings.llmEnabled) return next()

    const policy = policyForLlm(settings)
    const failure = payload?.failure
    const provider = payload?.provider ?? 'unknown'
    const agent = payload?.agent
    const signal = payload?.signal

    // Non-eligible failure: delegate downstream (built-in or turn failure).
    if (!isLlmRetryable(failure, policy)) return next()

    const code = typeof failure?.code === 'string' ? failure.code : null
    count(agent, 'llmAttempts')
    markLast(agent, code)

    // Caller already gone: do not schedule.
    if (signal?.aborted) return undefined

    const key = llmPolicyKey(provider, policy)
    const turn = payload?.turn
    const step = payload?.step
    let previous
    try {
      const state = getState?.(agent?.session)
      previous = state?.[key]
    } catch {
      previous = undefined
    }
    // New turn/step = new chain (mirrors built-in reset on step/start, turn/end).
    // Without this, one exhausted 10/10 would silence all later failures.
    const sameChain =
      previous != null &&
      (turn === undefined || previous.turn === undefined || previous.turn === turn) &&
      (step === undefined || previous.step === undefined || previous.step === step)
    const previousRetry = sameChain && typeof previous?.retry === 'number' && previous.retry >= 0 ? previous.retry : 0
    if (!policy.unlimited && previousRetry >= policy.maxRetries) return next()

    const retry = previousRetry + 1
    const retryId =
      sameChain && typeof previous?.retryId === 'string' && previous.retryId.length > 0 ? previous.retryId : randomUUID()
    const { delayMs } = resolveLlmDelay(retry, policy, failure, nextRandom)
    const policyKey = key

    const eventData =
      policy.mode === 'always'
        ? {
            retryId,
            turn: payload?.turn,
            step: payload?.step,
            provider,
            mode: policy.mode,
            policyKey,
            retry,
            delayMs,
            failure,
          }
        : {
            retryId,
            turn: payload?.turn,
            step: payload?.step,
            provider,
            mode: policy.mode,
            policyKey,
            retry,
            maxRetries: policy.maxRetries,
            delayMs,
            failure,
          }

    count(agent, 'llmRetries')
    appendEvent(agent, LLM_RETRY_EVENT, eventData)
    try {
      onScheduled?.(agent?.session, policyKey, { retry, retryId, turn, step })
    } catch {
      // Persistence must never break recovery.
    }
    if (!(await wait(delayMs, signal))) return undefined
    appendEvent(agent, LLM_RETRY_STARTED_EVENT, {
      retryId,
      turn: payload?.turn,
      step: payload?.step,
      retry,
    })
    return { kind: 'retry' }
  }
}
