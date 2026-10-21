/**
 * dsh-timeout — exponential backoff retry strategy for DeepSeek Harness.
 *
 * Tools: DSH dispatches every tool call through the `tools/execute`
 * waterfall. The default behavior is a single attempt: when a call fails or
 * hits a deadline, the error reaches the model directly and the model has to
 * re-issue the call by hand. This plugin wraps that waterfall and, for
 * configured tools and error codes, retries the call with an exponential
 * backoff:
 *
 *   delay = min(maxTimeoutMs, minTimeoutMs * factor ^ (attempt - 1))
 *
 * until the call succeeds, the attempt budget is exhausted, or the caller
 * cancels. The budget is `maxAttempts` total attempts, or unlimited when the
 * `unlimited` flag is set.
 *
 * Models: when `llmEnabled` is on, the plugin also listens on
 * `agent/request-error` and retries failed model requests
 * (`Retried model request (retry/maximum)` in chat, `retry/∞` when
 * `llmUnlimited`). Events are `llm/retry` / `llm/retry-started`, so the chat
 * UI renders them like the built-in llm-retry executor. Tools and models are
 * fully independent: `enabled` gates only tools, `llmEnabled` gates only
 * models, each with its own count/unlimited, delays, jitter and codes.
 * To count from this plugin only, disable the built-in executor for the
 * route (provider `retryPolicy: { mode: "normal", maxRetries: 0, ... }`);
 * otherwise totals add up (built-in + this plugin).
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
 *   llmEnabled    boolean               retry model requests (default false)
 *   llmUnlimited  boolean               unlimited model retries = retry/∞
 *                                       (default false)
 *   llmMaxRetries number                model retries after first failure
 *                                       (default 10)
 *   llmMinTimeoutMs number              first model retry delay (default 1000)
 *   llmMaxTimeoutMs number              model delay ceiling (default 30000)
 *   llmFactor     number                model delay growth factor (default 2)
 *   llmCodes      string[]              model codes to retry (default
 *                                       [EMPTY_RESPONSE,RATE_LIMIT,SERVER,
 *                                        TIMEOUT,TRANSPORT]; ["*"] = any)
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
// Tools for the tool wrapper; agents + sessionProjections for model recovery
// (read-only best-effort; missing services fall back to in-memory counting).
export const inject = ['tools', 'agents', 'sessionProjections']
