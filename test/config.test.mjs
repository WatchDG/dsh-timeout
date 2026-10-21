// Config normalization tests. No Harness required.
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CODES, normalizeConfig, snapshot } from '../lib/config.js'

test('defaults match the documented behavior', () => {
  const c = normalizeConfig({})
  assert.equal(c.enabled, true)
  assert.equal(c.maxAttempts, 3)
  assert.equal(c.unlimited, false)
  assert.equal(c.minTimeoutMs, 1000)
  assert.equal(c.maxTimeoutMs, 60000)
  assert.equal(c.factor, 2)
  assert.deepEqual(c.codes, DEFAULT_CODES)
  assert.deepEqual([...c.tools], [])
  assert.equal(c.armTimeout, true)
})

test('explicit values pass through', () => {
  const c = normalizeConfig({
    enabled: false,
    maxAttempts: 7,
    unlimited: true,
    minTimeoutMs: 250,
    maxTimeoutMs: 8000,
    factor: 1.5,
    codes: ['TOOL_TIMEOUT', 'ABORTED'],
    tools: ['pwsh', 'bash'],
    armTimeout: false,
  })
  assert.equal(c.enabled, false)
  assert.equal(c.maxAttempts, 7)
  assert.equal(c.unlimited, true)
  assert.equal(c.minTimeoutMs, 250)
  assert.equal(c.maxTimeoutMs, 8000)
  assert.equal(c.factor, 1.5)
  assert.deepEqual(c.codes, ['TOOL_TIMEOUT', 'ABORTED'])
  assert.deepEqual([...c.tools], ['pwsh', 'bash'])
  assert.equal(c.armTimeout, false)
})

test('maxTimeoutMs below minTimeoutMs is raised to min', () => {
  const c = normalizeConfig({ minTimeoutMs: 5000, maxTimeoutMs: 1000 })
  assert.equal(c.minTimeoutMs, 5000)
  assert.equal(c.maxTimeoutMs, 5000)
})

test('invalid numbers fall back to defaults', () => {
  const c = normalizeConfig({
    maxAttempts: 0,
    minTimeoutMs: -5,
    maxTimeoutMs: 'x',
    factor: 1,
  })
  assert.equal(c.maxAttempts, 3)
  assert.equal(c.minTimeoutMs, 1000)
  assert.equal(c.maxTimeoutMs, 60000)
  assert.equal(c.factor, 2)
})

test('codes are trimmed, uppercased, deduped; empty falls back to default', () => {
  assert.deepEqual(normalizeConfig({ codes: [' tool_timeout ', 'TOOL_TIMEOUT', ''] }).codes, ['TOOL_TIMEOUT'])
  assert.deepEqual(normalizeConfig({ codes: [] }).codes, DEFAULT_CODES)
  assert.deepEqual(normalizeConfig({ codes: ['*'] }).codes, ['*'])
})

test('tools become a trimmed set', () => {
  const c = normalizeConfig({ tools: [' pwsh ', '', 'bash'] })
  assert.deepEqual([...c.tools], ['pwsh', 'bash'])
})

test('boolean flags follow explicit false', () => {
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ unlimited: true }).unlimited, true)
  assert.equal(normalizeConfig({ armTimeout: false }).armTimeout, false)
})

test('snapshot unwraps volatile-like references', () => {
  const volatile = (value) => ({ get: () => value })
  const c = snapshot({
    enabled: volatile(false),
    maxAttempts: volatile(5),
    unlimited: volatile(true),
    minTimeoutMs: volatile(100),
    maxTimeoutMs: volatile(900),
    factor: volatile(1.1),
    codes: volatile(['A', 'B']),
    tools: volatile(['pwsh']),
    armTimeout: volatile(false),
  })
  assert.equal(c.enabled, false)
  assert.equal(c.maxAttempts, 5)
  assert.equal(c.unlimited, true)
  assert.equal(c.minTimeoutMs, 100)
  assert.equal(c.maxTimeoutMs, 900)
  assert.equal(c.factor, 1.1)
  assert.deepEqual(c.codes, ['A', 'B'])
  assert.deepEqual([...c.tools], ['pwsh'])
  assert.equal(c.armTimeout, false)
})

test('snapshot handles a null config', () => {
  const c = snapshot(null)
  assert.equal(c.enabled, true)
  assert.equal(c.maxAttempts, 3)
})
