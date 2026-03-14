/**
 * AgentProvider — pluggable interface for LLM agent CLIs.
 *
 * Each provider wraps a CLI (claude, gemini, codex) and runs prompts
 * with full agent capabilities (tool use, file access, reasoning).
 * Used by eval judge, code review gates, spec review, and any
 * prompt-in/text-out agent task.
 *
 * Design: fail-open by default. All providers bypass permissions
 * unless explicitly configured otherwise. This is intentional —
 * kata agents run headless and must not block on approval prompts.
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

/**
 * Provider capability flags — lets the runner know what each provider supports.
 */
export interface ProviderCapabilities {
  /** Supports per-tool filtering via allowedTools. */
  toolFiltering: boolean
  /** Supports maxTurns control. */
  maxTurns: boolean
  /** Supports text-only mode (no tools at all). */
  textOnly: boolean
  /** How the provider handles permission bypass. */
  permissionBypass: 'sdk' | 'cli-flag' | 'always'
}

export interface AgentProvider {
  /** Provider identifier: 'claude' | 'gemini' | 'codex' */
  name: string
  /** Provider-specific default model. Undefined = CLI's own default. */
  defaultModel?: string
  /** Hardcoded known models for this provider. */
  models: ModelOption[]
  /** What this provider supports. */
  capabilities: ProviderCapabilities
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

  // ── Full-agent session options (defaults preserve text-only behavior) ──

  /**
   * Tools the agent can use. Uses kata canonical names (Claude Code names).
   * Special values:
   *   - undefined/[]: text-only, no tools
   *   - ['all']: give all available tools (yolo mode)
   *   - ['Read', 'Grep', ...]: specific tools
   */
  allowedTools?: string[]
  /** Max agentic turns. Default: 3 (judge/review mode). */
  maxTurns?: number
  /**
   * Permission mode for the agent session.
   * Default: 'bypassPermissions' (fail-open — agents run headless).
   * Set explicitly to override, e.g. 'default' for interactive approval.
   */
  permissionMode?: string
  /** Settings sources to load (e.g., ['project'] for .claude/settings.json). Default: []. */
  settingSources?: string[]
  /** PreToolUse hook — return allow/deny decisions for tool calls. */
  canUseTool?: (tool: unknown) => unknown
  /** AbortController for cancellation. Provider creates one if not provided. */
  abortController?: AbortController
  /** Streaming callback — receives every SDK message as it arrives. */
  onMessage?: (message: unknown) => void
}

/**
 * Canonical tool names (aligned with Claude Code).
 * These are the names users pass to --tools; each provider maps them internally.
 */
export const CANONICAL_TOOLS = [
  'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
  'Agent', 'NotebookEdit', 'WebFetch', 'WebSearch',
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList',
  'AskUserQuestion',
] as const

export type CanonicalTool = (typeof CANONICAL_TOOLS)[number]

/** Check if tools list means "give all tools". */
export function isAllTools(tools?: string[]): boolean {
  return tools?.length === 1 && tools[0] === 'all'
}
