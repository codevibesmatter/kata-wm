/**
 * AgentProvider — pluggable interface for LLM agent CLIs.
 *
 * Each provider wraps a CLI (claude, gemini, codex) and runs prompts
 * with full agent capabilities (tool use, file access, reasoning).
 * Used by eval judge, code review gates, spec review, and any
 * prompt-in/text-out agent task.
 */

export interface ThinkingLevel {
  id: string
  description: string
}

export interface ModelOption {
  id: string
  description: string
  default?: boolean
  thinkingLevels?: ThinkingLevel[]
}

export interface AgentProvider {
  /** Provider identifier: 'claude' | 'gemini' | 'codex' */
  name: string
  /** Provider-specific default model. Undefined = CLI's own default. */
  defaultModel?: string
  /** Hardcoded known models for this provider. */
  models: ModelOption[]
  /**
   * Fetch live model list from CLI cache or API.
   * Falls back to static `models` array if unavailable.
   */
  fetchModels?: () => Promise<ModelOption[]>
  /** Run a prompt through the agent and return the text response. */
  run(prompt: string, options: AgentRunOptions): Promise<string>
}

export interface AgentRunOptions {
  /** Working directory for the agent process. */
  cwd: string
  /** Override the provider's default model. */
  model?: string
  /** Pre-cleaned environment variables. Providers use as-is. */
  env?: Record<string, string>
  /** Max execution time in ms. Default: 300_000 (5 min). */
  timeoutMs?: number
}
