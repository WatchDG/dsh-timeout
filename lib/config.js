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
  })
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
  }
}
