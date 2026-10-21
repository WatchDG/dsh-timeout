// Model-request recovery tests. No Harness required.
import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig, policyForLlm, snapshot } from '../lib/config.js'
import { isLlmRetryable, llmPolicyKey, resolveLlmDelay } from '../lib/backoff.js'
import { createRecoverWithBackoff } from '../lib/llm.js'

const IMMEDIATE = async () => true

function makeAgent() {
  const events = []
  return {
    agent: { id: 's1', session: { append: (type, data) => events.push({ type, data }) } },
    events,
  }
}

function payloadFor(agent, failure, provider = 'opencode-go') {
  return {
    agent,
    turn: 't1',
    step: 's1',
    provider,
    failure,
    signal: new AbortController().signal,
  }
}

test('llm defaults match built-in retryable set with longer budget', () => {
  const c = normalizeConfig({})
  assert.equal(c.llmEnabled, false)
  assert.equal(c.llmUnlimited, false)
  assert.equal(c.llmMaxRetries, 10)
  assert.deepEqual(c.llmCodes, ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'])
  const p = policyForLlm(c)
  assert.equal(p.mode, 'normal')
  assert.equal(p.maxRetries, 10)
})

test('llm snapshot unwraps volatile refs', () => {
  const volatile = (value) => ({ get: () => value })
  const c = snapshot({ llmEnabled: volatile(true), llmUnlimited: volatile(true), llmMaxRetries: volatile(0) })
  assert.equal(c.llmEnabled, true)
  assert.equal(c.llmUnlimited, true)
  assert.equal(c.llmMaxRetries, 0)
})

test('isLlmRetryable matches codes case-insensitively, * matches anything', () => {
  assert.equal(isLlmRetryable({ code: 'TRANSPORT', message: 'x' }, { codes: ['TRANSPORT'] }), true)
  assert.equal(isLlmRetryable({ code: 'transport', message: 'x' }, { codes: ['TRANSPORT'] }), true)
  assert.equal(isLlmRetryable({ code: 'UNKNOWN', message: 'x' }, { codes: ['TRANSPORT'] }), false)
  assert.equal(isLlmRetryable({ code: 'UNKNOWN', message: 'x' }, { codes: ['*'] }), true)
  assert.equal(isLlmRetryable({ code: 'TRANSPORT', message: 'x' }, { llmCodes: ['TRANSPORT'] }), true)
})

test('llmPolicyKey changes when behavior-affecting fields change', () => {
  const base = policyForLlm(normalizeConfig({ llmMaxRetries: 10 }))
  const other = policyForLlm(normalizeConfig({ llmMaxRetries: 11 }))
  assert.notEqual(llmPolicyKey('p', base), llmPolicyKey('p', other))
  assert.equal(llmPolicyKey('p', base), llmPolicyKey('p', base))
})

test('resolveLlmDelay honors Retry-After within ceiling, else backoff', () => {
  const policy = policyForLlm(normalizeConfig({ llmMinTimeoutMs: 1000, llmMaxTimeoutMs: 30000, llmFactor: 2 }))
  const remote = resolveLlmDelay(1, policy, { code: 'RATE_LIMIT', providerRetryAfterMs: 1500 }, () => 0.5)
  assert.equal(remote.remote, true)
  assert.equal(remote.delayMs, 1500)
  const overCap = resolveLlmDelay(1, policy, { code: 'RATE_LIMIT', providerRetryAfterMs: 999999 }, () => 0.5)
  assert.equal(overCap.remote, false)
  const local = resolveLlmDelay(2, policy, { code: 'TRANSPORT' }, () => 0.5)
  // base 2000 * equal jitter 0.2 with random 0.5 = 2000
  assert.equal(local.delayMs, 2000)
})

test('disabled llm delegates without retry', async () => {
  const { agent, events } = makeAgent()
  const stats = { llmAttempts: 0, llmRetries: 0, llmLastCode: null }
  const recover = createRecoverWithBackoff({
    readSettings: () => normalizeConfig({ llmEnabled: false }),
    delay: IMMEDIATE,
    stats,
    sessions: new Map(),
  })
  let nextCalls = 0
  const decision = await recover(payloadFor(agent, { code: 'TRANSPORT', message: 'Connection error' }), async () => { nextCalls += 1; return undefined })
  assert.equal(decision, undefined)
  assert.equal(nextCalls, 1)
  assert.equal(events.length, 0)
})

test('tools switch does not gate model retries: each side on its own', async () => {
  const { agent, events } = makeAgent()
  const stats = { llmAttempts: 0, llmRetries: 0, llmLastCode: null }
  const recover = createRecoverWithBackoff({
    // Tools off, models on: model must still retry.
    readSettings: () => normalizeConfig({ enabled: false, llmEnabled: true, llmMaxRetries: 3 }),
    delay: IMMEDIATE,
    random: () => 0.5,
    stats,
    getState: () => ({}),
  })
  const decision = await recover(payloadFor(agent, { code: 'TRANSPORT', message: 'Connection error' }), async () => undefined)
  assert.deepEqual(decision, { kind: 'retry' })
  assert.equal(events.length, 2)
})

test('eligible TRANSPORT failure schedules retry with chat-compatible events', async () => {
  const { agent, events } = makeAgent()
  const stats = { llmAttempts: 0, llmRetries: 0, llmLastCode: null }
  const sessions = new Map()
  const memory = {}
  const recover = createRecoverWithBackoff({
    readSettings: () => normalizeConfig({ llmEnabled: true, llmMaxRetries: 10 }),
    delay: IMMEDIATE,
    random: () => 0.5,
    stats,
    sessions,
    getState: () => memory,
    onScheduled: (session, key, entry) => { memory[key] = entry },
  })
  const decision = await recover(payloadFor(agent, { code: 'TRANSPORT', message: 'Connection error' }), async () => undefined)
  assert.deepEqual(decision, { kind: 'retry' })
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'llm/retry')
  assert.equal(events[0].data.mode, 'normal')
  assert.equal(events[0].data.maxRetries, 10)
  assert.equal(events[0].data.retry, 1)
  assert.equal(typeof events[0].data.delayMs, 'number')
  assert.equal(events[1].type, 'llm/retry-started')
  assert.equal(stats.llmAttempts, 1)
  assert.equal(stats.llmRetries, 1)
  assert.equal(stats.llmLastCode, 'TRANSPORT')
})

test('exhausted budget delegates downstream', async () => {
  const { agent } = makeAgent()
  const stats = { llmAttempts: 0, llmRetries: 0, llmLastCode: null }
  const policy = policyForLlm(normalizeConfig({ llmMaxRetries: 1 }))
  const key = llmPolicyKey('opencode-go', policy)
  const memory = { [key]: { retry: 1, retryId: 'r1' } }
  const recover = createRecoverWithBackoff({
    readSettings: () => normalizeConfig({ llmEnabled: true, llmMaxRetries: 1 }),
    delay: IMMEDIATE,
    stats,
    getState: () => memory,
  })
  let nextCalls = 0
  const decision = await recover(payloadFor(agent, { code: 'TRANSPORT', message: 'x' }), async () => { nextCalls += 1; return undefined })
  assert.equal(decision, undefined)
  assert.equal(nextCalls, 1)
})

test('new turn/step starts a new chain (reset like built-in)', async () => {
  const { agent, events } = makeAgent()
  const stats = { llmAttempts: 0, llmRetries: 0, llmLastCode: null }
  const memory = {}
  const recover = createRecoverWithBackoff({
    readSettings: () => normalizeConfig({ llmEnabled: true, llmMaxRetries: 1 }),
    delay: IMMEDIATE,
    random: () => 0.5,
    stats,
    getState: () => memory,
    onScheduled: (session, key, entry) => { memory[key] = entry },
  })
  const first = await recover(
    { ...payloadFor(agent, { code: 'TRANSPORT', message: 'x' }), turn: 't1', step: 's1' },
    async () => undefined,
  )
  assert.deepEqual(first, { kind: 'retry' })
  // Same step, budget exhausted -> delegate.
  let nextCalls = 0
  const exhausted = await recover(
    { ...payloadFor(agent, { code: 'TRANSPORT', message: 'x' }), turn: 't1', step: 's1' },
    async () => { nextCalls += 1; return undefined },
  )
  assert.equal(exhausted, undefined)
  assert.equal(nextCalls, 1)
  // New step -> fresh chain, retries again with a new id.
  const fresh = await recover(
    { ...payloadFor(agent, { code: 'TRANSPORT', message: 'x' }), turn: 't1', step: 's2' },
    async () => undefined,
  )
  assert.deepEqual(fresh, { kind: 'retry' })
  assert.equal(events.filter((e) => e.type === 'llm/retry').length, 2)
  assert.notEqual(events[0].data.retryId, events[2].data.retryId)
})

test('unlimited maps to always mode with retry/∞', async () => {
  const { agent, events } = makeAgent()
  const stats = { llmAttempts: 0, llmRetries: 0, llmLastCode: null }
  const recover = createRecoverWithBackoff({
    readSettings: () => normalizeConfig({ llmEnabled: true, llmUnlimited: true }),
    delay: IMMEDIATE,
    random: () => 0.5,
    stats,
    getState: () => ({}),
  })
  const decision = await recover(payloadFor(agent, { code: 'TRANSPORT', message: 'x' }), async () => undefined)
  assert.deepEqual(decision, { kind: 'retry' })
  assert.equal(events[0].data.mode, 'always')
  assert.equal('maxRetries' in events[0].data, false)
})
