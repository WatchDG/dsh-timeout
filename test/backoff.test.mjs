// Pure strategy-math tests. No Harness required.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TOOL_TIMEOUT,
  applyJitter,
  cancellableDelay,
  computeDelay,
  delayFor,
  isRetryable,
  makeDeadline,
  toolTimeoutResult,
} from '../lib/backoff.js'

const SETTINGS = { minTimeoutMs: 1000, maxTimeoutMs: 60000, factor: 2 }

test('delayFor grows exponentially and caps at maxTimeoutMs', () => {
  assert.equal(delayFor(1, SETTINGS), 1000)
  assert.equal(delayFor(2, SETTINGS), 2000)
  assert.equal(delayFor(3, SETTINGS), 4000)
  assert.equal(delayFor(7, SETTINGS), 60000)
  assert.equal(delayFor(50, SETTINGS), 60000)
})

test('delayFor tolerates the attempt 0 or negative', () => {
  assert.equal(delayFor(0, SETTINGS), 1000)
  assert.equal(delayFor(-3, SETTINGS), 1000)
})

test('delayFor honors custom min, max, factor', () => {
  assert.equal(delayFor(1, { minTimeoutMs: 500, maxTimeoutMs: 10000, factor: 3 }), 500)
  assert.equal(delayFor(2, { minTimeoutMs: 500, maxTimeoutMs: 10000, factor: 3 }), 1500)
  assert.equal(delayFor(4, { minTimeoutMs: 500, maxTimeoutMs: 10000, factor: 3 }), 10000)
})

test('delayFor always returns at least 1 ms', () => {
  assert.equal(delayFor(1, { minTimeoutMs: 1, maxTimeoutMs: 1, factor: 2 }), 1)
})

test('isRetryable matches configured codes (case-insensitive)', () => {
  const settings = { codes: ['TOOL_TIMEOUT'] }
  assert.equal(isRetryable({ isError: true, error: { info: { code: 'TOOL_TIMEOUT' } } }, settings), true)
  assert.equal(isRetryable({ isError: true, error: { info: { code: 'tool_timeout' } } }, settings), true)
  assert.equal(isRetryable({ isError: true, error: { info: { code: 'COMMAND_FAILED' } } }, settings), false)
})

test('isRetryable requires an error result', () => {
  const settings = { codes: ['*'] }
  assert.equal(isRetryable({ isError: false }, settings), false)
  assert.equal(isRetryable(null, settings), false)
  assert.equal(isRetryable('nope', settings), false)
})

test('isRetryable wildcard matches any failure, even without a code', () => {
  const settings = { codes: ['*'] }
  assert.equal(isRetryable({ isError: true, error: { message: 'x' } }, settings), true)
  assert.equal(isRetryable({ isError: true, error: { info: { code: 'WHATEVER' } } }, settings), true)
})

test('isRetryable never matches a failure without a structured code by default', () => {
  const settings = { codes: ['TOOL_TIMEOUT'] }
  assert.equal(isRetryable({ isError: true, error: { message: 'x' } }, settings), false)
})

test('cancellableDelay resolves true after the delay', async () => {
  const started = Date.now()
  const ok = await cancellableDelay(25, new AbortController().signal)
  assert.equal(ok, true)
  assert.ok(Date.now() - started >= 20)
})

test('cancellableDelay resolves false on abort', async () => {
  const controller = new AbortController()
  const pending = cancellableDelay(1000, controller.signal)
  controller.abort()
  assert.equal(await pending, false)
})

test('cancellableDelay on an already-aborted signal resolves false', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(await cancellableDelay(1, controller.signal), false)
})

test('makeDeadline fires after the budget', async () => {
  const deadline = makeDeadline(new AbortController().signal, 20)
  const firedAt = Date.now() + 40
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(deadline.fired, true)
  assert.equal(deadline.signal.aborted, true)
  assert.equal(deadline.signal.reason?.code, TOOL_TIMEOUT)
  void firedAt
  deadline.dispose()
})

test('makeDeadline propagates upstream abort without claiming fired', async () => {
  const upstream = new AbortController()
  const deadline = makeDeadline(upstream.signal, 1000)
  upstream.abort(new Error('caller cancelled'))
  assert.equal(deadline.fired, false)
  assert.equal(deadline.signal.aborted, true)
  assert.equal(deadline.signal.reason?.message, 'caller cancelled')
  deadline.dispose()
})

test('makeDeadline dispose cancels the timer', async () => {
  const deadline = makeDeadline(new AbortController().signal, 10)
  deadline.dispose()
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(deadline.fired, false)
  assert.equal(deadline.signal.aborted, false)
})

test('toolTimeoutResult is a structured TOOL_TIMEOUT failure', () => {
  const result = toolTimeoutResult(5000)
  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, TOOL_TIMEOUT)
  assert.match(result.content[0].text, /timed out after 5000ms/)
})

test('applyJitter none keeps the base delay', () => {
  assert.equal(applyJitter(1000, 'none', 0.5, () => 0.99), 1000)
})

test('applyJitter equal spreads ±ratio around the base', () => {
  const base = 2000
  const ratio = 0.5
  assert.equal(applyJitter(base, 'equal', ratio, () => 0), base * 0.5)
  assert.equal(applyJitter(base, 'equal', ratio, () => 1), base * 1.5)
  assert.equal(applyJitter(base, 'equal', ratio, () => 0.5), base)
})

test('applyJitter full is uniform 0..base', () => {
  const base = 4000
  assert.equal(applyJitter(base, 'full', 0.5, () => 0), 0)
  assert.equal(applyJitter(base, 'full', 0.5, () => 1), base)
  assert.equal(applyJitter(base, 'full', 0.5, () => 0.25), base * 0.25)
})

test('computeDelay includes jitter and never returns below 1 ms', () => {
  const settings = { minTimeoutMs: 1000, maxTimeoutMs: 60000, factor: 2, jitter: 'full', jitterRatio: 0.5 }
  assert.equal(computeDelay(1, settings, () => 0), 1)
  assert.equal(computeDelay(1, settings, () => 0.5), 500)
  assert.equal(computeDelay(1, settings, () => 1), 1000)
  const none = { ...settings, jitter: 'none' }
  assert.equal(computeDelay(3, none), 4000)
})
