// Settings-page component tests: load client.js the way the browser module
// loader does, then render the Backoff section with a stubbed React.
// No Harness, no DOM, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/**
 * Load the client module and capture the component it registers.
 *
 * @param {object[]} state Initial `useState` values, in call order.
 */
function loadSection(state) {
  let registration
  const context = { window: { __ModuleLoader__: { load: (value) => { registration = value } } }, console }
  vm.runInNewContext(SOURCE, context)

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    // The queue makes the first render see real status/draft values without a renderer.
    useState: (initial) => [state.length > 0 ? state.shift() : typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  }

  const components = new Map()
  const ctx = {
    effect: (callback) => {
      callback()
      return () => {}
    },
    locale: { register: () => {}, bind: () => (key) => key },
    configForms: {
      whileServed: (_namespaces, callback) => {
        callback(new Set(['backoff']))
        return () => {}
      },
      get: () => ({ set: async () => {}, readonly: false }),
    },
    slots: {
      inject: (_name, callback) => {
        callback()
        return () => {}
      },
      register: (meta, component) => {
        components.set(meta.id, component)
        return () => {}
      },
    },
  }

  const client = registration.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected require(${specifier})`)
  })
  client.apply(ctx)
  return components.get('backoff')
}

/** Collect every text node from a rendered tree. */
function texts(node, acc = []) {
  if (node === null || node === undefined || node === false) return acc
  if (typeof node === 'string' || typeof node === 'number') {
    acc.push(String(node))
    return acc
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, acc)
    return acc
  }
  if (typeof node === 'object' && Array.isArray(node.children)) {
    for (const child of node.children) texts(child, acc)
  }
  return acc
}

const STATUS = {
  enabled: true,
  settings: {
    maxAttempts: 10,
    unlimited: false,
    minTimeoutMs: 1000,
    maxTimeoutMs: 60000,
    factor: 2,
    codes: ['TOOL_TIMEOUT'],
    tools: [],
    armTimeout: true,
    jitter: 'equal',
    jitterRatio: 0.5,
    toolOverrides: {},
    llmEnabled: true,
    llmUnlimited: false,
    llmMaxRetries: 10,
    llmMinTimeoutMs: 1000,
    llmMaxTimeoutMs: 30000,
    llmFactor: 2,
    llmCodes: ['TRANSPORT'],
    llmJitter: 'equal',
    llmJitterRatio: 0.2,
  },
  stats: {
    attempts: 96,
    retries: 0,
    timeouts: 0,
    lastCode: 'SEARCH_FAILED',
    llmAttempts: 128,
    llmRetries: 127,
    llmLastCode: 'TRANSPORT',
  },
  sessions: [
    {
      sessionId: 'session-8acdb5c0-8263-414c-ab5e-b219b837e826',
      attempts: 96,
      retries: 0,
      timeouts: 0,
      lastCode: 'SEARCH_FAILED',
      llmAttempts: 128,
      llmRetries: 127,
      llmLastCode: 'TRANSPORT',
    },
  ],
}

/** Props the Settings host injects. */
const props = {
  fetchStatus: async () => STATUS,
  setField: async () => {},
  readonly: false,
}

test('per-session activity shows model retries even when tool retries are 0', () => {
  const Section = loadSection([STATUS, 0, {}, null, ''])
  const rendered = texts(Section(props))
  assert.ok(rendered.includes('127 model retries'), 'session model retries are rendered')
  assert.ok(rendered.includes('0 tool retries'), 'tool retries stay visible and labelled')
  assert.ok(rendered.includes('128 model attempts'), 'session model attempts are rendered')
  assert.ok(rendered.includes('TRANSPORT'), 'session model last code is rendered')
})

test('global live counters render model retries with tool/model labels', () => {
  const Section = loadSection([STATUS, 0, {}, null, ''])
  const rendered = texts(Section(props))
  assert.ok(rendered.includes('127'))
  assert.ok(rendered.includes('model retries'))
  assert.ok(rendered.includes('tool retries'))
  assert.ok(rendered.includes('tool attempts'))
})

test('an unavailable status still renders the explanatory message, not a crash', () => {
  const Section = loadSection([false, 0, {}, null, ''])
  const rendered = texts(Section(props))
  assert.ok(rendered.some((text) => text.includes('not served by the Host')))
})
