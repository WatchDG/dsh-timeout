/**
 * dsh-timeout — exponential backoff retry strategy for DeepSeek Harness.
 *
 * DSH dispatches every tool call through the `tools/execute` waterfall. The
 * default behavior is a single attempt: when a call fails or hits a deadline,
 * the error reaches the model directly and the model has to re-issue the call
 * by hand. This plugin wraps that waterfall and, for configured tools and
 * error codes, retries the call with an exponential backoff:
 *
 *   delay = min(maxTimeoutMs, minTimeoutMs * factor ^ (attempt - 1))
 *
 * until the call succeeds, the attempt budget is exhausted, or the caller
 * cancels. The budget is `maxAttempts` total attempts, or unlimited when the
 * `unlimited` flag is set.
 *
 * Config (all optional, read from the bundle row, editable live from the
 * Settings page thanks to volatile fields):
 *
 *   enabled       boolean               master switch (default true)
 *   maxAttempts   number                total attempts per call (default 3)
 *   unlimited     boolean               ignore maxAttempts (default false)
 *   minTimeoutMs  number                first retry delay in ms (default 1000)
 *   maxTimeoutMs  number                delay ceiling in ms (default 60000)
 *   factor        number                delay growth factor (default 2)
 *   codes         string[]              error codes that trigger a retry
 *                                       (default [TOOL_TIMEOUT]; ["*"] = any)
 *   tools         string[]              tool names to cover (default [] = all)
 *   armTimeout    boolean               enforce per-attempt tool timeoutMs
 *                                       deadlines when a tool declares one
 *                                       (default true)
 */

import { Config, snapshot } from './lib/config.js'
import { mount } from './lib/plugin.js'

/**
 * Activate the plugin for one profile context.
 *
 * The raw config (with volatile references) is passed through: the `tools/execute`
 * wrapper and the status route re-read it on every call, so Settings writes apply
 * without remounting.
 *
 * @param {object} ctx Plugin context supplied by the DSH loader.
 * @param {unknown} config Bundle row config.
 */
export function apply(ctx, config) {
  mount(ctx, config)
}

export { Config }
export const name = 'backoff'
export const inject = ['tools']
