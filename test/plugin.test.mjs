// Plugin wiring tests with a fake `next()`, a fake tool definition, and a fake
// plugin context. No Harness is required.
//
// The fake `next()` enforces the DSH 0.2.2 (Cordis 4.1.0) contract: a waterfall
// `next()` is single-use and throws `next() called multiple times` when called
// again. Retries therefore have to go through the resolved tool definition, and
// these tests fail if the loop ever calls `next()` twice.
import test from 'node:test'
import assert from 'node:assert/strict'

import { policyFor, snapshot } from '../lib/config.js'
import { RETRY_EVENT, RETRY_STARTED_EVENT, STATUS_PATH, createExecuteWithBackoff, mount, statusView } from '../lib/plugin.js'

const SUCCESS = { isError: false, value: { ok: true } }
const FAIL = (code) => ({ isError: true, error: { message: 'boom', info: code ? { code } : undefined } })

/** A thrown tool error carrying a routable code, as a real tool body would. */
const THROW = (code) => {
  const error = new Error('boom')
  error.name = 'ToolError'
  error.code = code
  return { throws: error }
}

/** Consume a scripted step list, repeating its last entry. */
function step(list, index) {
  return list[Math.min(index, list.length - 1)]
}

/**
 * Build a retry-loop executor with scripted dispatch and body outcomes.
 *
 * @param {{
 *   config?: unknown,
 *   dispatch?: object[],
 *   body?: (object | ((exec: object) => Promise<unknown>))[],
 *   timeoutMs?: number,
 *   resolveDefinition?: boolean,
 *   delay?: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   agent?: object,
 *   sessions?: Map<string, object>,
 * }} [options]
 */
function createRun({
  config = {},
  dispatch = [SUCCESS],
  body = [{ ok: true }],
  timeoutMs = 5000,
  resolveDefinition = true,
  delay,
  agent,
  sessions,
} = {}) {
  const stats = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }
  let nextCalls = 0
  let bodyCalls = 0
  let bodyIndex = 0
  const bodyExecs = []

  const definition = {
    timeoutMs,
    async execute(_args, exec) {
      bodyCalls += 1
      bodyExecs.push(exec)
      const next = step(body, bodyIndex)
      bodyIndex += 1
      if (typeof next === 'function') return next(exec)
      if (next && next.throws) throw next.throws
      return next
    },
  }

  const loop = createExecuteWithBackoff({
    readSettings: () => snapshot(config),
    getToolDefinition: () => (resolveDefinition ? definition : undefined),
    delay,
    stats,
    sessions,
  })

  const exec = { name: 'pwsh', signal: new AbortController().signal, agent }
  const next = async () => {
    nextCalls += 1
    if (nextCalls > 1) throw new Error('next() called multiple times')
    const result = step(dispatch, 0)
    return typeof result === 'function' ? result(exec) : result
  }

  const run = () => loop(exec, next)
  return {
    stats,
    exec,
    run,
    definition,
    get nextCalls() {
      return nextCalls
    },
    get bodyCalls() {
      return bodyCalls
    },
    get bodyExecs() {
      return bodyExecs
    },
  }
}

const IMMEDIATE = async () => true

test('passes a successful first attempt through untouched', async () => {
  const h = createRun()
  const result = await h.run()
  assert.equal(result, SUCCESS)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 0)
  assert.deepEqual(h.stats, { attempts: 1, retries: 0, timeouts: 0, lastCode: null })
})

test('disabled plugin dispatches exactly once', async () => {
  const h = createRun({ config: { enabled: false }, dispatch: [FAIL('TOOL_TIMEOUT')] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 0)
})

test('a tool outside the configured set is not retried', async () => {
  const h = createRun({ config: { tools: ['bash'] }, dispatch: [FAIL('TOOL_TIMEOUT')] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 0)
})

test('a non-retryable code is returned unchanged', async () => {
  const h = createRun({ dispatch: [FAIL('COMMAND_FAILED')] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'COMMAND_FAILED')
  assert.equal(h.bodyCalls, 0)
})

test('a failure without a structured code is not retried by default', async () => {
  const h = createRun({ dispatch: [FAIL(null)] })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.bodyCalls, 0)
})

test('retries a TOOL_TIMEOUT through the tool body and returns the raw success value', async () => {
  const h = createRun({ dispatch: [FAIL('TOOL_TIMEOUT')], body: [{ ok: true }], delay: IMMEDIATE })
  const result = await h.run()
  // A retried attempt returns the raw body value: the registry's
  // normalizeDispatchResult re-renders it through the tool's output contract.
  assert.deepEqual(result, { isError: false, value: { ok: true } })
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 1)
  assert.equal(h.stats.attempts, 2)
  assert.equal(h.stats.retries, 1)
})

test('next() is called exactly once per dispatch no matter how many retries run', async () => {
  const h = createRun({
    config: { maxAttempts: 5 },
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), { ok: true }],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 4)
})

test('a retry re-runs the body with the same execution object', async () => {
  const h = createRun({ dispatch: [FAIL('TOOL_TIMEOUT')], body: [{ ok: true }], delay: IMMEDIATE })
  await h.run()
  assert.equal(h.bodyExecs.length, 1)
  assert.equal(h.bodyExecs[0], h.exec, 'call identity and approvals stay those of attempt 1')
})

test('a throwing body failure is classified by its structured code', async () => {
  const h = createRun({ dispatch: [FAIL('TOOL_TIMEOUT')], body: [THROW('TOOL_TIMEOUT'), { ok: true }], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.bodyCalls, 2)
  assert.equal(h.stats.lastCode, 'TOOL_TIMEOUT', 'the last failure code stays recorded after the retry succeeds')
})

test('respects maxAttempts and returns the final failure', async () => {
  const h = createRun({
    config: { maxAttempts: 3 },
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT')],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'TOOL_TIMEOUT')
  assert.equal(h.stats.retries, 2)
  assert.equal(h.stats.attempts, 3)
})

test('unlimited retries until success', async () => {
  const h = createRun({
    config: { unlimited: true, maxAttempts: 1 },
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), { ok: true }],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.stats.attempts, 6)
})

test('wildcard code retries a failure without a structured code', async () => {
  const h = createRun({ config: { codes: ['*'] }, dispatch: [FAIL(null)], body: [{ ok: true }], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.bodyCalls, 1)
})

test('does not retry when the tool definition cannot be resolved', async () => {
  const h = createRun({ dispatch: [FAIL('TOOL_TIMEOUT')], resolveDefinition: false })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 0)
  assert.equal(h.stats.retries, 0)
})

test('stops retrying when the wait is cancelled', async () => {
  let waitCalls = 0
  const h = createRun({
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [{ ok: true }],
    delay: async () => {
      waitCalls += 1
      return false
    },
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 0)
  assert.equal(waitCalls, 1)
})

test('never retries a call whose caller signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const h = createRun({ dispatch: [FAIL('TOOL_TIMEOUT')] })
  h.exec.signal = controller.signal
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.bodyCalls, 0)
})

test('per-attempt deadline turns a hung call into a retryable timeout', async () => {
  // A dispatch body and a tool body that only settle when their signal aborts,
  // the way a real cancellable tool behaves.
  const hanged = (exec) =>
    new Promise((resolve) => {
      exec.signal.addEventListener('abort', () => resolve(FAIL('ABORTED')), { once: true })
    })
  const hungBody = (exec) =>
    new Promise((_, reject) => {
      exec.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  const h = createRun({
    config: { maxAttempts: 2 },
    dispatch: [hanged],
    body: [hungBody, hungBody],
    timeoutMs: 30,
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'TOOL_TIMEOUT')
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 1)
  assert.equal(h.stats.timeouts, 2)
})

test('armTimeout off leaves a hung call alone', async () => {
  const controller = new AbortController()
  const hangs = () =>
    new Promise((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(FAIL('ABORTED')), { once: true })
    })
  const h = createRun({
    config: { armTimeout: false, maxAttempts: 2 },
    dispatch: [hangs],
    timeoutMs: 30,
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
  assert.equal(h.nextCalls, 1)
  controller.abort()
  await pending
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'ABORTED')
})

test('a throwing next() with wildcard codes is retried through the body', async () => {
  const h = createRun({ config: { codes: ['*'] }, dispatch: [async () => { throw new Error('transient') }], body: [{ ok: true }], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.nextCalls, 1)
  assert.equal(h.bodyCalls, 1)
})

test('a thrown error without a name and code is not classified', async () => {
  const h = createRun({ config: { codes: ['*'] }, dispatch: [async () => { throw new Error('transient') }], body: [{ ok: true }], delay: IMMEDIATE })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.stats.lastCode, null, 'a plain Error carries no routable code')
})

test('per-tool override raises the attempt budget beyond the global cap', async () => {
  const h = createRun({
    config: { maxAttempts: 2, toolOverrides: { pwsh: { maxAttempts: 4 } } },
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), { ok: true }],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.stats.attempts, 4)
})

test('per-tool override replaces the retryable code list', async () => {
  const h = createRun({
    config: { toolOverrides: { pwsh: { codes: ['MY_CODE'] } } },
    dispatch: [FAIL('MY_CODE')],
    body: [{ ok: true }],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, false)
  assert.equal(h.bodyCalls, 1)
})

test('an override for another tool does not affect this tool', async () => {
  const h = createRun({
    config: { maxAttempts: 2, toolOverrides: { bash: { maxAttempts: 9 } } },
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT'), THROW('TOOL_TIMEOUT')],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, true)
  assert.equal(h.stats.attempts, 2)
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
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [{ ok: true }],
    delay: IMMEDIATE,
  })
  const result = await h.run()
  assert.equal(result.isError, false)
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
    dispatch: [FAIL('TOOL_TIMEOUT')],
    body: [THROW('TOOL_TIMEOUT'), { ok: true }],
    delay: IMMEDIATE,
  })
  await h.run()
  const record = sessions.get('s1')
  assert.equal(record.attempts, 3)
  assert.equal(record.retries, 2)
  assert.equal(record.timeouts, 0)
  assert.equal(record.lastCode, 'TOOL_TIMEOUT')
})

test('statusView exposes model retry counters per session, not only globally', () => {
  const sessions = new Map([
    ['s1', { attempts: 3, retries: 0, timeouts: 0, lastCode: 'SEARCH_FAILED', llmAttempts: 5, llmRetries: 4, llmLastCode: 'TRANSPORT' }],
    // Legacy record without llm fields: must be repaired, not rendered as NaN.
    ['s2', { attempts: 1, retries: 0, timeouts: 0, lastCode: null }],
  ])
  const stats = { attempts: 4, retries: 0, timeouts: 0, lastCode: 'SEARCH_FAILED', llmAttempts: 5, llmRetries: 4, llmLastCode: 'TRANSPORT' }
  const view = statusView(snapshot({}), stats, sessions)
  assert.equal(view.stats.llmRetries, 4)
  const row = view.sessions.find((entry) => entry.sessionId === 's1')
  assert.equal(row.retries, 0)
  assert.equal(row.llmAttempts, 5)
  assert.equal(row.llmRetries, 4)
  assert.equal(row.llmLastCode, 'TRANSPORT')
  const legacy = view.sessions.find((entry) => entry.sessionId === 's2')
  assert.equal(legacy.llmAttempts, 0)
  assert.equal(legacy.llmRetries, 0)
  assert.equal(legacy.llmLastCode, null)
})

test('statusView orders sessions by combined tool and model activity', () => {
  const sessions = new Map([
    ['tool-heavy', { attempts: 10, retries: 0, timeouts: 0, lastCode: null }],
    ['model-heavy', { attempts: 1, retries: 0, timeouts: 0, lastCode: null, llmAttempts: 20, llmRetries: 19, llmLastCode: 'TRANSPORT' }],
  ])
  const view = statusView(snapshot({}), { attempts: 11, retries: 0, timeouts: 0, lastCode: null }, sessions)
  assert.deepEqual(view.sessions.map((row) => row.sessionId), ['model-heavy', 'tool-heavy'])
})

test('mount registers the tools/execute listener and dispatches through it', async () => {
  const listeners = new Map()
  const exec = { name: 'pwsh', signal: new AbortController().signal }
  let bodyRuns = 0
  const ctx = {
    tools: {
      executable: () => ({ timeoutMs: 5000, execute: async () => ({ ok: ++bodyRuns }) }),
      get: () => ({ timeoutMs: 5000, execute: async () => ({ ok: ++bodyRuns }) }),
    },
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {}
    },
  }
  mount(ctx, {}, { delay: IMMEDIATE })
  const listener = listeners.get('tools/execute')
  assert.equal(typeof listener, 'function')

  let nextCalls = 0
  const result = await listener(exec, async () => {
    nextCalls += 1
    if (nextCalls > 1) throw new Error('next() called multiple times')
    return FAIL('TOOL_TIMEOUT')
  })
  assert.equal(result.isError, false)
  assert.deepEqual(result, { isError: false, value: { ok: 1 } })
  assert.equal(nextCalls, 1)
  assert.equal(bodyRuns, 1)
  assert.equal(STATUS_PATH, '/backoff/status')
})

test('mount prefers the execution lookup with the step tool set', async () => {
  const listeners = new Map()
  const seen = []
  const toolSet = { view: () => new Map() }
  const definition = { timeoutMs: 1000, execute: async () => ({ ok: true }) }
  const ctx = {
    tools: {
      executable: (name, scope, set) => {
        seen.push(['executable', name, scope, set])
        return definition
      },
      get: (name) => {
        seen.push(['get', name])
        return definition
      },
    },
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {}
    },
  }
  mount(ctx, {}, { delay: IMMEDIATE })
  const agent = { id: 's1' }
  const exec = { name: 'pwsh', signal: new AbortController().signal, agent, toolSet }
  await listeners.get('tools/execute')(exec, async () => SUCCESS)
  assert.deepEqual(seen, [['executable', 'pwsh', agent, toolSet]])
})

test('mount falls back to the registry lookup when no tool set admits the tool', async () => {
  const listeners = new Map()
  const ctx = {
    tools: {
      executable: () => undefined,
      get: (name) => ({ name, timeoutMs: 1000, execute: async () => ({ ok: true }) }),
    },
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {}
    },
  }
  mount(ctx, {}, { delay: IMMEDIATE })
  const result = await listeners.get('tools/execute')(
    { name: 'pwsh', signal: new AbortController().signal },
    async () => FAIL('TOOL_TIMEOUT'),
  )
  assert.deepEqual(result, { isError: false, value: { ok: true } })
})
