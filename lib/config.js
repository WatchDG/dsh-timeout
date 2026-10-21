/**
 * dsh-timeout — configuration normalization and the settings schema.
 *
 * The bundle row's `config` is user-authored YAML, so every field is optional
 * and every value is validated here, at activation, instead of at each hook
 * invocation.
 *
 * `Config` is the same shape as a schema: the settings service serves only
 * volatile fields, so the Settings page can rewrite them while the plugin
 * stays loaded. `snapshot()` unwraps those live references back into the
 * plain values the hook and the status route consume.
 */

import z from '@deepseek-ai/schemastery'

/** Default: retry only calls that hit their deadline (the classic bad case). */
export const DEFAULT_CODES = ['TOOL_TIMEOUT']

/** Default first retry delay. */
export const DEFAULT_MIN_TIMEOUT_MS = 1000

/** Default delay ceiling. */
export const DEFAULT_MAX_TIMEOUT_MS = 60000

/** Default growth factor. */
export const DEFAULT_FACTOR = 2

/** Default total attempts per call (unless `unlimited`). */
export const DEFAULT_MAX_ATTEMPTS = 3

/** No tool filter by default — every tool is covered. */
export const DEFAULT_TOOLS = []

/** Jitter modes: fixed, centered spread (default), or full 0..base. */
export const JITTER_MODES = ['none', 'equal', 'full']

/** Default jitter mode. */
export const DEFAULT_JITTER = 'equal'

/** Default centered spread for `equal` jitter (±50 %). */
export const DEFAULT_JITTER_RATIO = 0.5

/** Default retryable model-request codes (mirrors built-in llm-retry defaults). */
export const DEFAULT_LLM_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']

/** Default model-retry master switch: off, so tools-only installs never double-retry. */
export const DEFAULT_LLM_ENABLED = false

/** Default model retries when `llmEnabled` (retries after the first failure). */
export const DEFAULT_LLM_MAX_RETRIES = 10

/** Default first model-retry delay. */
export const DEFAULT_LLM_MIN_TIMEOUT_MS = 1000

/** Default model-retry delay ceiling. */
export const DEFAULT_LLM_MAX_TIMEOUT_MS = 30000

/** Default model-retry growth factor. */
export const DEFAULT_LLM_FACTOR = 2

/** Default model-retry jitter spread (±20 %, like the llm-retry README example). */
export const DEFAULT_LLM_JITTER_RATIO = 0.2

/**
 * Runtime configuration.
 *
 * `.volatile()` is what makes the Settings page work: the settings service
 * exposes only volatile fields, and a write replaces the reference in place
 * instead of remounting the plugin.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  maxAttempts: z.number().step(1).min(1).default(DEFAULT_MAX_ATTEMPTS).volatile(),
  unlimited: z.boolean().default(false).volatile(),
  minTimeoutMs: z.number().min(100).default(DEFAULT_MIN_TIMEOUT_MS).volatile(),
  maxTimeoutMs: z.number().min(100).default(DEFAULT_MAX_TIMEOUT_MS).volatile(),
  factor: z.number().min(1.01).default(DEFAULT_FACTOR).volatile(),
  codes: z.array(z.string()).default([...DEFAULT_CODES]).volatile(),
  tools: z.array(z.string()).default([...DEFAULT_TOOLS]).volatile(),
  armTimeout: z.boolean().default(true).volatile(),
  jitter: z.union(JITTER_MODES).default(DEFAULT_JITTER).volatile(),
  jitterRatio: z.number().min(0.01).max(1).default(DEFAULT_JITTER_RATIO).volatile(),
  llmEnabled: z.boolean().default(DEFAULT_LLM_ENABLED).volatile(),
  llmUnlimited: z.boolean().default(false).volatile(),
  llmMaxRetries: z.number().step(1).min(0).default(DEFAULT_LLM_MAX_RETRIES).volatile(),
  llmMinTimeoutMs: z.number().min(100).default(DEFAULT_LLM_MIN_TIMEOUT_MS).volatile(),
  llmMaxTimeoutMs: z.number().min(100).default(DEFAULT_LLM_MAX_TIMEOUT_MS).volatile(),
  llmFactor: z.number().min(1.01).default(DEFAULT_LLM_FACTOR).volatile(),
  llmCodes: z.array(z.string()).default([...DEFAULT_LLM_CODES]).volatile(),
  llmJitter: z.union(JITTER_MODES).default(DEFAULT_JITTER).volatile(),
  llmJitterRatio: z.number().min(0).max(1).default(DEFAULT_LLM_JITTER_RATIO).volatile(),
  // The inner fields must NOT be volatile: nested volatile fields inside a
  // volatile container are rejected by the loader ("volatile fields require a
  // fixed object path without an enclosing volatile field"). The whole map is
  // one volatile reference; the Settings page writes it as one plain object.
  toolOverrides: z
    .dict(
      z.object({
        maxAttempts: z.number().step(1).min(1),
        unlimited: z.boolean(),
        minTimeoutMs: z.number().min(100),
        maxTimeoutMs: z.number().min(100),
        factor: z.number().min(1.01),
        codes: z.array(z.string()),
        armTimeout: z.boolean(),
        jitter: z.union(JITTER_MODES),
        jitterRatio: z.number().min(0.01).max(1),
      }),
    )
    .default({})
    .volatile(),
})

/**
 * Read one Config field, tolerating a plain value when the schema is parsed
 * without the volatile wrapper (tests, older readers).
 *
 * @param {unknown} value Stored field value or volatile reference.
 * @param {unknown} fallback Value when nothing usable is stored.
 * @returns {unknown} the stored choice.
 */
function live(value, fallback) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      const current = value.get()
      return current === undefined ? fallback : current
    } catch {
      return fallback
    }
  }
  return value === undefined ? fallback : value
}

/**
 * Unwrap volatile Config references into a plain object `normalizeConfig`
 * accepts, then normalize. Call it on every use, not once at activation:
 * the Settings page may replace a field between two hook invocations.
 *
 * @param {unknown} raw Plugin Config with optional volatile references.
 * @returns {ReturnType<typeof normalizeConfig>}
 */
export function snapshot(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return normalizeConfig({
    enabled: live(source.enabled, undefined),
    maxAttempts: live(source.maxAttempts, undefined),
    unlimited: live(source.unlimited, undefined),
    minTimeoutMs: live(source.minTimeoutMs, undefined),
    maxTimeoutMs: live(source.maxTimeoutMs, undefined),
    factor: live(source.factor, undefined),
    codes: live(source.codes, undefined),
    tools: live(source.tools, undefined),
    armTimeout: live(source.armTimeout, undefined),
    jitter: live(source.jitter, undefined),
    jitterRatio: live(source.jitterRatio, undefined),
    toolOverrides: live(source.toolOverrides, undefined),
    llmEnabled: live(source.llmEnabled, undefined),
    llmUnlimited: live(source.llmUnlimited, undefined),
    llmMaxRetries: live(source.llmMaxRetries, undefined),
    llmMinTimeoutMs: live(source.llmMinTimeoutMs, undefined),
    llmMaxTimeoutMs: live(source.llmMaxTimeoutMs, undefined),
    llmFactor: live(source.llmFactor, undefined),
    llmCodes: live(source.llmCodes, undefined),
    llmJitter: live(source.llmJitter, undefined),
    llmJitterRatio: live(source.llmJitterRatio, undefined),
  })
}

/** Normalize one optional number field, or undefined to inherit. */
function optionalNumber(value, min, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= min) return value
  return value === undefined ? undefined : fallback
}

/** Normalize one optional code list, or undefined to inherit. */
function optionalCodes(value) {
  if (value === undefined) return undefined
  const codes = [...new Set(Array.isArray(value) ? value : [])]
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
  return codes.length > 0 ? codes : undefined
}

/** Normalize one optional jitter mode, or undefined to inherit. */
function optionalJitter(value) {
  return JITTER_MODES.includes(value) ? value : undefined
}

/** Normalize one per-tool override entry (partial; missing fields inherit). */
function normalizeOverride(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const entry = {}
  const maxAttempts = optionalNumber(source.maxAttempts, 1, undefined)
  if (maxAttempts !== undefined) entry.maxAttempts = maxAttempts
  if (source.unlimited === true) entry.unlimited = true
  else if (source.unlimited === false) entry.unlimited = false
  const minTimeoutMs = optionalNumber(source.minTimeoutMs, 100, undefined)
  if (minTimeoutMs !== undefined) entry.minTimeoutMs = minTimeoutMs
  let maxTimeoutMs = optionalNumber(source.maxTimeoutMs, 100, undefined)
  if (maxTimeoutMs !== undefined) {
    if (maxTimeoutMs < minTimeoutMs) maxTimeoutMs = minTimeoutMs
    entry.maxTimeoutMs = maxTimeoutMs
  }
  const factor = optionalNumber(source.factor, 1.01, undefined)
  if (factor !== undefined) entry.factor = factor
  const codes = optionalCodes(source.codes)
  if (codes !== undefined) entry.codes = codes
  if (source.armTimeout === true) entry.armTimeout = true
  else if (source.armTimeout === false) entry.armTimeout = false
  const jitter = optionalJitter(source.jitter)
  if (jitter !== undefined) entry.jitter = jitter
  const jitterRatio = optionalNumber(source.jitterRatio, 0.01, undefined)
  if (jitterRatio !== undefined) entry.jitterRatio = Math.min(1, jitterRatio)
  return entry
}

/**
 * Normalize the loader row's config.
 *
 * @param {unknown} raw Value from the bundle row (`config` in the patch layer).
 * @returns {{
 *   enabled: boolean,
 *   maxAttempts: number,
 *   unlimited: boolean,
 *   minTimeoutMs: number,
 *   maxTimeoutMs: number,
 *   factor: number,
 *   codes: string[],
 *   tools: Set<string>,
 *   armTimeout: boolean,
 *   jitter: 'none' | 'equal' | 'full',
 *   jitterRatio: number,
 *   toolOverrides: Record<string, object>,
 *   llmEnabled: boolean,
 *   llmUnlimited: boolean,
 *   llmMaxRetries: number,
 *   llmMinTimeoutMs: number,
 *   llmMaxTimeoutMs: number,
 *   llmFactor: number,
 *   llmCodes: string[],
 *   llmJitter: 'none' | 'equal' | 'full',
 *   llmJitterRatio: number,
 * }}
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}

  const finitePositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0

  const minTimeoutMs = finitePositive(source.minTimeoutMs) ? source.minTimeoutMs : DEFAULT_MIN_TIMEOUT_MS
  let maxTimeoutMs = finitePositive(source.maxTimeoutMs) ? source.maxTimeoutMs : DEFAULT_MAX_TIMEOUT_MS
  // A ceiling below the base delay is meaningless; the ceiling wins only when
  // it is above the base.
  if (maxTimeoutMs < minTimeoutMs) maxTimeoutMs = minTimeoutMs

  const factor = finitePositive(source.factor) && source.factor > 1 ? source.factor : DEFAULT_FACTOR

  const maxAttempts =
    Number.isInteger(source.maxAttempts) && source.maxAttempts >= 1 ? source.maxAttempts : DEFAULT_MAX_ATTEMPTS

  const asStringArray = (value) => (Array.isArray(value) ? value : value instanceof Set ? [...value] : [])
  const codes = [...new Set(asStringArray(source.codes).filter((v) => typeof v === 'string').map((v) => v.trim().toUpperCase()).filter(Boolean))]
  const tools = new Set(
    asStringArray(source.tools)
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean),
  )

  const jitter = JITTER_MODES.includes(source.jitter) ? source.jitter : DEFAULT_JITTER
  const jitterRatio =
    typeof source.jitterRatio === 'number' && Number.isFinite(source.jitterRatio) && source.jitterRatio >= 0.01 && source.jitterRatio <= 1
      ? source.jitterRatio
      : DEFAULT_JITTER_RATIO

  const toolOverrides = {}
  if (source.toolOverrides !== null && typeof source.toolOverrides === 'object') {
    for (const [rawTool, entry] of Object.entries(source.toolOverrides)) {
      const tool = String(rawTool).trim()
      if (!tool) continue
      // Keep the entry even when empty: the tool is present with default
      // (inherited) behavior and stays visible in the Settings editor.
      toolOverrides[tool] = normalizeOverride(entry)
    }
  }

  const llmMinTimeoutMs = finitePositive(source.llmMinTimeoutMs) ? source.llmMinTimeoutMs : DEFAULT_LLM_MIN_TIMEOUT_MS
  let llmMaxTimeoutMs = finitePositive(source.llmMaxTimeoutMs) ? source.llmMaxTimeoutMs : DEFAULT_LLM_MAX_TIMEOUT_MS
  if (llmMaxTimeoutMs < llmMinTimeoutMs) llmMaxTimeoutMs = llmMinTimeoutMs
  const llmFactor = finitePositive(source.llmFactor) && source.llmFactor > 1 ? source.llmFactor : DEFAULT_LLM_FACTOR
  const llmMaxRetries =
    Number.isInteger(source.llmMaxRetries) && source.llmMaxRetries >= 0 ? source.llmMaxRetries : DEFAULT_LLM_MAX_RETRIES
  const llmCodes = [...new Set(asStringArray(source.llmCodes).filter((v) => typeof v === 'string').map((v) => v.trim().toUpperCase()).filter(Boolean))]
  const llmJitter = JITTER_MODES.includes(source.llmJitter) ? source.llmJitter : DEFAULT_JITTER
  const llmJitterRatio =
    typeof source.llmJitterRatio === 'number' && Number.isFinite(source.llmJitterRatio) && source.llmJitterRatio >= 0 && source.llmJitterRatio <= 1
      ? source.llmJitterRatio
      : DEFAULT_LLM_JITTER_RATIO

  return {
    enabled: source.enabled !== false,
    maxAttempts,
    unlimited: source.unlimited === true,
    minTimeoutMs,
    maxTimeoutMs,
    factor,
    codes: codes.length > 0 ? codes : [...DEFAULT_CODES],
    tools,
    armTimeout: source.armTimeout !== false,
    jitter,
    jitterRatio,
    toolOverrides,
    llmEnabled: source.llmEnabled === true,
    llmUnlimited: source.llmUnlimited === true,
    llmMaxRetries,
    llmMinTimeoutMs,
    llmMaxTimeoutMs,
    llmFactor,
    llmCodes: llmCodes.length > 0 ? llmCodes : [...DEFAULT_LLM_CODES],
    llmJitter,
    llmJitterRatio,
  }
}

/**
 * Resolve the effective retry policy for one tool: the global settings with
 * that tool's override entry applied on top (missing override fields inherit).
 *
 * @param {ReturnType<typeof normalizeConfig>} settings Normalized settings.
 * @param {string} tool Tool name.
 * @returns {{
 *   maxAttempts: number,
 *   unlimited: boolean,
 *   minTimeoutMs: number,
 *   maxTimeoutMs: number,
 *   factor: number,
 *   codes: string[],
 *   armTimeout: boolean,
 *   jitter: 'none' | 'equal' | 'full',
 *   jitterRatio: number,
 * }}
 */
export function policyFor(settings, tool) {
  const o = settings.toolOverrides[tool]
  return {
    maxAttempts: o?.maxAttempts ?? settings.maxAttempts,
    unlimited: o?.unlimited ?? settings.unlimited,
    minTimeoutMs: o?.minTimeoutMs ?? settings.minTimeoutMs,
    maxTimeoutMs: o?.maxTimeoutMs ?? settings.maxTimeoutMs,
    factor: o?.factor ?? settings.factor,
    codes: o?.codes ?? settings.codes,
    armTimeout: o?.armTimeout ?? settings.armTimeout,
    jitter: o?.jitter ?? settings.jitter,
    jitterRatio: o?.jitterRatio ?? settings.jitterRatio,
  }
}

/**
 * Resolve the effective model-request retry policy (global LLM settings).
 * Shape mirrors the provider `retryPolicy` so the chat UI can render
 * `retry/maxRetries` or `retry/∞` from the same `llm/retry` events.
 *
 * @param {ReturnType<typeof normalizeConfig>} settings Normalized settings.
 * @returns {{
 *   mode: 'normal' | 'always',
 *   maxRetries: number,
 *   unlimited: boolean,
 *   minTimeoutMs: number,
 *   maxTimeoutMs: number,
 *   factor: number,
 *   codes: string[],
 *   jitter: 'none' | 'equal' | 'full',
 *   jitterRatio: number,
 * }}
 */
export function policyForLlm(settings) {
  const unlimited = settings.llmUnlimited === true
  return {
    mode: unlimited ? 'always' : 'normal',
    maxRetries: settings.llmMaxRetries,
    unlimited,
    minTimeoutMs: settings.llmMinTimeoutMs,
    maxTimeoutMs: settings.llmMaxTimeoutMs,
    factor: settings.llmFactor,
    codes: settings.llmCodes,
    jitter: settings.llmJitter,
    jitterRatio: settings.llmJitterRatio,
  }
}
