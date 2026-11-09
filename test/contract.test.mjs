// Contract tests against the real Cordis 4.1.0 runtime shipped with DSH 0.2.2.
//
// DSH 0.2.2 moved to Cordis 4.1.0, where a waterfall `next()` is single-use:
// the second call throws `next() called multiple times`. The plugin's retry loop
// used to call `next()` once per attempt, which silently broke every tool retry
// on that release. These tests pin the real dispatch contract, so a future
// Cordis change cannot regress the plugin unnoticed.
import test from 'node:test'
import assert from 'node:assert/strict'

import { Context } from '@deepseek-ai/cordis'

import { snapshot } from '../lib/config.js'
import { createExecuteWithBackoff } from '../lib/plugin.js'

const FAIL = (code) => ({ isError: true, error: { message: 'boom', info: code ? { code } : undefined } })

/** A tool definition whose body counts its own runs. */
function countingDefinition(values = []) {
  const runs = []
  return {
    runs,
    definition: {
      async execute(args, exec) {
        runs.push({ args, exec })
        return values.length === 0 ? { ok: runs.length } : values.shift()
      },
    },
  }
}

/** Build a retry loop wired exactly the way `mount()` wires it. */
function wire(ctx, { definition, config = {}, delay = async () => true }) {
  const stats = { attempts: 0, retries: 0, timeouts: 0, lastCode: null }
  const loop = createExecuteWithBackoff({
    readSettings: () => snapshot({ maxAttempts: 3, minTimeoutMs: 100, ...config }),
    getToolDefinition: () => definition,
    delay,
    stats,
  })
  ctx.on('tools/execute', (exec, next) => loop(exec, next))
  return stats
}

test('Cordis 4.1.0: a waterfall next() is single-use', async () => {
  const ctx = new Context()
  let thrown
  ctx.on('tools/execute', async (exec, next) => {
    await next()
    try {
      await next()
    } catch (error) {
      thrown = error
    }
    return { isError: false }
  })
  await ctx.waterfall('tools/execute', { name: 'demo', signal: new AbortController().signal }, async () => ({
    isError: false,
  }))
  assert.equal(thrown?.message, 'next() called multiple times')
})

test('a successful first attempt is passed through untouched', async () => {
  const ctx = new Context()
  const tool = countingDefinition()
  wire(ctx, { definition: tool.definition })

  const first = { isError: false, value: { ok: 'first' } }
  let nextCalls = 0
  const result = await ctx.waterfall(
    'tools/execute',
    { name: 'pwsh', signal: new AbortController().signal },
    async () => {
      nextCalls += 1
      return first
    },
  )
  assert.equal(result, first)
  assert.equal(nextCalls, 1)
  assert.equal(tool.runs.length, 0, 'the body is not re-run for a successful first attempt')
})

test('retries run the tool body through the resolved definition, not next()', async () => {
  const ctx = new Context()
  const tool = countingDefinition([{ ok: 'retried' }])
  const stats = wire(ctx, { definition: tool.definition })

  let nextCalls = 0
  const result = await ctx.waterfall(
    'tools/execute',
    { name: 'pwsh', signal: new AbortController().signal },
    async () => {
      nextCalls += 1
      return FAIL('TOOL_TIMEOUT')
    },
  )

  assert.equal(nextCalls, 1, 'next() is called exactly once per dispatch')
  assert.deepEqual(result, { isError: false, value: { ok: 'retried' } })
  assert.equal(tool.runs.length, 1)
  assert.equal(stats.attempts, 2)
  assert.equal(stats.retries, 1)
})

test('a retry reuses the dispatch execution as its run context', async () => {
  const ctx = new Context()
  const tool = countingDefinition([{ ok: true }])
  wire(ctx, { definition: tool.definition })

  const exec = { name: 'pwsh', signal: new AbortController().signal }
  await ctx.waterfall('tools/execute', exec, async () => FAIL('TOOL_TIMEOUT'))

  assert.equal(tool.runs.length, 1)
  assert.equal(tool.runs[0].exec, exec, 'call identity and approvals stay those of attempt 1')
})

test('the attempt budget bounds the retries under the real waterfall', async () => {
  const ctx = new Context()
  const tool = countingDefinition([])
  // Every retry succeeds, but a script that keeps failing must stop at maxAttempts.
  tool.definition.execute = async () => {
    tool.runs.push({})
    throw Object.assign(new Error('boom'), { name: 'ToolError', code: 'TOOL_TIMEOUT' })
  }
  const stats = wire(ctx, { definition: tool.definition, config: { maxAttempts: 3 } })

  const result = await ctx.waterfall(
    'tools/execute',
    { name: 'pwsh', signal: new AbortController().signal },
    async () => FAIL('TOOL_TIMEOUT'),
  )

  assert.equal(result.isError, true)
  assert.equal(result.error.info.code, 'TOOL_TIMEOUT')
  assert.equal(stats.attempts, 3)
  assert.equal(stats.retries, 2)
  assert.equal(tool.runs.length, 2)
})

test('a cancelled caller stops the retry chain under the real waterfall', async () => {
  const ctx = new Context()
  const controller = new AbortController()
  const tool = countingDefinition([{ ok: true }])
  const stats = wire(ctx, {
    definition: tool.definition,
    delay: async () => {
      controller.abort()
      return false
    },
  })

  const result = await ctx.waterfall('tools/execute', { name: 'pwsh', signal: controller.signal }, async () =>
    FAIL('TOOL_TIMEOUT'),
  )

  assert.equal(result.isError, true)
  assert.equal(stats.retries, 1)
  assert.equal(tool.runs.length, 0, 'a cancelled wait never starts the retried body')
})
