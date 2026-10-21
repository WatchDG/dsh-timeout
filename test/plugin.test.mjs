// Plugin wiring tests with a fake `next()` and a fake plugin context.
// No Harness is required.
import test from 'node:test'
import assert from 'node:assert/strict'

import { policyFor, snapshot } from '../lib/config.js'
import { RETRY_EVENT, RETRY_STARTED_EVENT, STATUS_PATH, createExecuteWithBackoff, mount } from '../lib/plugin.js'

const SUCCESS = { isError: false, value: { ok: true } }
const FAIL = (code) => ({ isError: true, error: { message: 'boom', info: code ? { code } : undefined } })

/**
 * Build a retry-loop executor with scripted tool results.
 *
 * @param {{
 *   config?: unknown,
 *   results?: object[],
 *   getToolTimeoutMs?: (exec: object) => number | undefined,
 *   delay?: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   agent?: object,
 *   sessions?: Map<string, object>,
 * }} [options]
 */
function createRun({ config = {}, results = [SUCCESS], getToolTimeoutMs = () => 5000, delay, agent, sessions } = {}) {
  const stats = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }
  const loop = createExecuteWithBackoff({
    readSettings: () => snapshot(config),
    getToolTimeoutMs,
    delay,
    stats,
    sessions,
  })
  let runs = 0
  const exec = { name: 'pwsh', signal: new AbortController().signal, agent }
  const next = async () => {
    runs += 1
    const body = results[Math.min(runs - 1, results.length - 1)]
    return typeof body === 'function' ? body(exec) : body
  }
  const run = () => loop(exec, next)
  return { stats, exec, run, get runs() { return runs } }
}

const IMMEDIATE = async () => true

test('passes a successful first attempt through untouched', async () => {
  const h = createRun()
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.runs, 1)
  assert.deepEqual(h.stats, { attempts: 1, retries: 0, timeouts: 0, lastCode: null })
})

test('disabled plugin dispatches exactly once', async () => {
  const h = createRun({ config: { enabled: false }, results: [FAIL('TOOL_TIMEOUT')] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 1)
})

test('a tool outside the configured set is not retried', async () => {
  const h = createRun({ config: { tools: ['bash'] }, results: [FAIL('TOOL_TIMEOUT')] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 1)
})

test('a non-retryable code is returned unchanged', async () => {
  const h = createRun({ results: [FAIL('COMMAND_FAILED')] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'COMMAND_FAILED')
  assert.equal(h.runs, 1)
})

test('a failure without a structured code is not retried by default', async () => {
  const h = createRun({ results: [FAIL(null)] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 1)
})

test('retries a TOOL_TIMEOUT and returns the eventual success', async () => {
  const h = createRun({ results: [FAIL('TOOL_TIMEOUT'), SUCCESS], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.runs, 2)
  assert.equal(h.stats.attempts, 2)
  assert.equal(h.stats.retries, 1)
})

test('respects maxAttempts and returns the final failure', async () => {
  const h = createRun({ config: { maxAttempts: 3 }, results: [FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT')], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 3)
  assert.equal(h.stats.retries, 2)
})

test('unlimited retries until success', async () => {
  const failures = Array.from({ length: 5 }, () => FAIL('TOOL_TIMEOUT'))
  const h = createRun({ config: { unlimited: true, maxAttempts: 1 }, results: [...failures, SUCCESS], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.runs, 6)
})

test('wildcard code retries a failure without a structured code', async () => {
  const h = createRun({ config: { codes: ['*'] }, results: [FAIL(null), SUCCESS], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.runs, 2)
})

test('stops retrying when the wait is cancelled', async () => {
  let waitCalls = 0
  const controller = new AbortController()
  const h = createRun({
    results: [FAIL('TOOL_TIMEOUT'), SUCCESS],
    delay: async () => {
      waitCalls += 1
      controller.abort()
      return false
    },
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 1)
  assert.equal(waitCalls, 1)
  void controller
})

test('never retries a call whose caller signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const h = createRun({ results: [FAIL('TOOL_TIMEOUT')] })
  h.exec.signal = controller.signal
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 1)
})

test('per-attempt deadline turns a hung call into a retryable timeout', async () => {
  // Simulates a dispatch body that only settles when its signal aborts
  // (the deadline signal), the way a real cancellable tool body behaves.
  const hanged = (exec) =>
    new Promise((resolve) => {
      const onAbort = () => resolve(FAIL('ABORTED'))
      exec.signal.addEventListener('abort', onAbort, { once: true })
    })
  const h = createRun({
    config: { maxAttempts: 2 },
    results: [hanged, hanged],
    getToolTimeoutMs: () => 30,
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'TOOL_TIMEOUT')
  assert.equal(h.runs, 2)
  assert.equal(h.stats.timeouts, 2)
})

test('armTimeout off leaves a hung call alone', async () => {
  const controller = new AbortController()
  // Simulates a cancellable dispatch body: it only settles when the caller aborts.
  const hangs = () =>
    new Promise((resolve) => {
      const onAbort = () => resolve(FAIL('ABORTED'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
  const h = createRun({
    config: { armTimeout: false, maxAttempts: 2 },
    results: [hangs()],
    getToolTimeoutMs: () => 30,
  })
  h.exec.signal = controller.signal
  let settled = false
  let result
  const pending = h.run().then((value) => {
    settled = true
    result = value
  })
  await new Promise((resolve) => setTimeout(resolve, 80))
  // No per-attempt deadline was armed: still running after the 30 ms budget.
  assert.equal(settled, false)
  assert.equal(h.runs, 1)
  controller.abort()
  await pending
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'ABORTED')
  assert.equal(h.runs, 1)
})

test('a throwing next() with wildcard codes is retried', async () => {
  let runs = 0
  const stats = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }
  const loop = createExecuteWithBackoff({
    readSettings: () => snapshot({ codes: ['*'] }),
    getToolTimeoutMs: () => undefined,
    delay: IMMEDIATE,
    stats,
  })
  const next = async () => {
    runs += 1
    if (runs === 1) throw new Error('transient')
    return SUCCESS
  }
  const result = await loop({ name: 'web_fetch', signal: new AbortController().signal }, next)
  assert.equal(result, SUCCESS)
  assert.equal(runs, 2)
})

test('per-tool override raises the attempt budget beyond the global cap', async () => {
  const h = createRun({
    config: { maxAttempts: 2, toolOverrides: { pwsh: { maxAttempts: 4 } } },
    results: [FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT'), SUCCESS],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.runs, 4)
})

test('per-tool override replaces the retryable code list', async () => {
  const h = createRun({
    config: { toolOverrides: { pwsh: { codes: ['MY_CODE'] } } },
    results: [FAIL('MY_CODE'), SUCCESS],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.runs, 2)
})

test('an override for another tool does not affect this tool', async () => {
  const h = createRun({
    config: { maxAttempts: 2, toolOverrides: { bash: { maxAttempts: 9 } } },
    results: [FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT')],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.runs, 2)
})

test('policyFor is used by the loop and merged correctly', () => {
  const settings = snapshot({ toolOverrides: { pwsh: { maxAttempts: 7 } } })
  const policy = policyFor(settings, 'pwsh')
  assert.equal(policy.maxAttempts, 7)
  assert.equal(policy.jitter, 'equal')
  assert.equal(policyFor(settings, 'bash').maxAttempts, 3)
})

test('durable session events are appended for each retry', async () => {
  const events = []
  const agent = { id: 's1', session: { append: (type, data) => events.push({ type, data }) } }
  const h = createRun({
    agent,
    results: [FAIL('TOOL_TIMEOUT'), SUCCESS],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(events.length, 2)
  assert.equal(events[0].type, RETRY_EVENT)
  assert.equal(events[0].data.tool, 'pwsh')
  assert.equal(events[0].data.attempt, 1)
  assert.equal(events[0].data.code, 'TOOL_TIMEOUT')
  assert.equal(typeof events[0].data.delayMs, 'number')
  assert.equal(events[0].data.callId, undefined)
  assert.equal(events[1].type, RETRY_STARTED_EVENT)
  assert.equal(events[1].data.attempt, 1)
})

test('per-session counters accumulate in the sessions map', async () => {
  const sessions = new Map()
  const agent = { id: 's1', session: { append: () => {} } }
  const h = createRun({
    agent,
    sessions,
    config: { maxAttempts: 3 },
    results: [FAIL('TOOL_TIMEOUT'), FAIL('TOOL_TIMEOUT'), SUCCESS],
    delay: IMMEDIATE,
  })
  await h.run()
  assert.equal(h.runs, 3)
  const record = sessions.get('s1')
  assert.equal(record.attempts, 3)
  assert.equal(record.retries, 2)
  assert.equal(record.timeouts, 0)
  assert.equal(record.lastCode, 'TOOL_TIMEOUT')
})

test('mount registers the tools/execute listener and dispatches through it', async () => {
  const listeners = new Map()
  const ctx = {
    tools: { get: () => ({ timeoutMs: 5000 }) },
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {}
    },
  }
  mount(ctx, {}, { delay: IMMEDIATE })
  const listener = listeners.get('tools/execute')
  assert.equal(typeof listener, 'function')

  let runs = 0
  const result = await listener(
    { name: 'pwsh', signal: new AbortController().signal },
    async () => {
      runs += 1
      return runs === 1 ? FAIL('TOOL_TIMEOUT') : SUCCESS
    },
  )
  assert.equal(result.isError, false)
  assert.equal(runs, 2)
  assert.equal(STATUS_PATH, '/backoff/status')
})
