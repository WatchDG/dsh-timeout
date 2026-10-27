// Packaging and display-metadata checks for the plugin bundle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

const pkg = JSON.parse(read('package.json'))

const REQUIRED_FILES = [
  'index.js',
  'client.js',
  'lib/config.js',
  'lib/backoff.js',
  'lib/plugin.js',
  'cordis.patch.yml',
  'locale/en.json',
  'locale/ru.json',
  'icon.svg',
  'README.md',
  'README.ru.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'NOTICE',
  '.gitignore',
]

test('manifest declares a DSH bundle', () => {
  assert.equal(pkg.name, 'dsh-timeout')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.license, 'Apache-2.0')
  assert.deepEqual(pkg.dsh.bundle, { patch: './cordis.patch.yml' })
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
})

test('every runtime file is shipped by npm', () => {
  assert.ok(pkg.files.includes('index.js'))
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(pkg.files.includes('lib/*.js'))
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.ok(pkg.files.includes('locale/*.json'))
  assert.ok(pkg.files.includes('icon.svg'))
  assert.ok(!pkg.files.includes('node_modules'), 'dependencies install from the registry')
})

test('the settings schema library is a declared dependency', () => {
  assert.ok(pkg.dependencies['@deepseek-ai/schemastery'], 'Config needs schemastery')
})

test('every required file exists and lib/ has no unshipped modules', () => {
  for (const relative of REQUIRED_FILES) {
    assert.ok(statSync(path.join(root, relative)).isFile(), `${relative} is missing`)
  }

  for (const entry of readdirSync(path.join(root, 'lib'))) {
    assert.ok(entry.endsWith('.js'), `unexpected file in lib/: ${entry}`)
    assert.ok(pkg.files.includes('lib/*.js'), `lib/${entry} is not covered by package files`)
  }
})

test('the bundle patch inserts the backoff row by package name', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /^-\s+insert:/m)
  assert.match(patch, /^\s+-\s+id:\s+backoff$/m)
  assert.match(patch, new RegExp(`^\\s+name:\\s+${pkg.name}$`, 'm'))
})

test('locale resources carry display metadata', () => {
  for (const locale of ['en', 'ru']) {
    const meta = JSON.parse(read(`locale/${locale}.json`)).meta
    assert.equal(typeof meta.title, 'string', `${locale} title`)
    assert.ok(meta.title.length > 0, `${locale} title is empty`)
    assert.equal(typeof meta.description, 'string', `${locale} description`)
    assert.ok(meta.description.length > 0, `${locale} description is empty`)
  }
})

test('the icon is an SVG below the display size limit', () => {
  const icon = read('icon.svg')
  assert.match(icon, /^<svg[\s>]/)
  assert.ok(Buffer.byteLength(icon) < 256 * 1024, 'icon exceeds 256 KiB')
})

test('documentation links to DeepSeek Harness and the repository', () => {
  for (const doc of ['README.md', 'README.ru.md']) {
    const text = read(doc)
    assert.match(text, /https:\/\/www\.deepseek\.com\/en\/harness\//, `${doc} links DeepSeek Harness`)
    assert.match(text, /https:\/\/github\.com\/WatchDG\/dsh-timeout/, `${doc} links the repository`)
  }
})

test('the changelog documents the current version', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`## \\[${pkg.version.replaceAll('.', '\\.')}\\]`))
})

test('the settings page renders per-session model counters and keeps status live', () => {
  const client = read('client.js')
  for (const key of ['sessionLlmAttempts', 'sessionLlmRetries', 'sessionLlmLastCode']) {
    assert.equal(client.split(`${key}:`).length - 1, 2, `${key} is defined in both dictionaries`)
    assert.equal(client.split(`t('${key}')`).length - 1, 1, `${key} is rendered in the session rows`)
  }
  assert.match(client, /STATUS_POLL_MS/)
  assert.match(client, /setInterval\(refresh, STATUS_POLL_MS\)/)
})

test('the plugin entry point exports the Host plugin contract', async () => {
  const module = await import('../index.js')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'backoff')
  assert.deepEqual(module.inject, ['tools', 'agents', 'sessionProjections'])
  assert.equal(module.Config?.type, 'object', 'settings service reads Config')
})
