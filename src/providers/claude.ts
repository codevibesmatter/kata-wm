/**
 * Claude provider — wraps @anthropic-ai/claude-agent-sdk query().
 *
 * Supports two modes via AgentRunOptions:
 * - Text-only (default): maxTurns=3, no tools — for judge/review tasks.
 * - Full-agent: pass allowedTools, maxTurns, settingSources for agentic sessions.
 *
 * Permission bypass: always on by default (fail-open). The SDK's default
 * is interactive approval, but kata agents run headless — blocking on
 * permission prompts would hang. Override with permissionMode if needed.
 */

import { createRequire } from 'node:module'
import type { AgentProvider, AgentRunOptions, ModelOption, ThinkingLevel } from './types.js'
import { isAllTools } from './types.js'

/** Resolve the SDK's bundled cli.js so nested query() calls find the executable. */
function resolveClaudeExecutable(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const sdkDir = require.resolve('@anthropic-ai/claude-agent-sdk/package.json').replace('/package.json', '')
    return `${sdkDir}/cli.js`
  } catch {
    return undefined
  }
}

const claudeThinking: ThinkingLevel[] = [
  { id: 'disabled', description: 'No extended thinking' },
  { id: 'enabled', description: 'Extended thinking enabled (budget tokens via API)' },
]

export const claudeProvider: AgentProvider = {
  name: 'claude',
  defaultModel: undefined,
  capabilities: {
    toolFiltering: true,
    maxTurns: true,
    textOnly: true,
    permissionBypass: 'sdk',
  },
  models: [
    { id: 'claude-opus-4-6', description: 'Flagship model, deep reasoning, 1M context', thinkingLevels: claudeThinking },
    { id: 'claude-sonnet-4-6', description: 'Best balance of speed and intelligence', default: true, thinkingLevels: claudeThinking },
    { id: 'claude-haiku-4-5', description: 'Fast and cheap for routine tasks', thinkingLevels: claudeThinking },
  ],

  async fetchModels(): Promise<ModelOption[]> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return this.models

    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (!res.ok) return this.models
      const data = (await res.json()) as { data: Array<{ id: string; display_name: string }> }
      return data.data
        .filter((m) => m.id.startsWith('claude-'))
        .map((m) => ({
          id: m.id,
          description: m.display_name,
          default: m.id === 'claude-sonnet-4-6',
        }))
    } catch {
      return this.models
    }
  },

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    // Dynamic import — claude-agent-sdk is a devDependency
    const { query } = (await import('@anthropic-ai/claude-agent-sdk')) as {
      query: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<{
        type: string
        message?: { content: Array<{ type: string; text?: string }> }
      }>
    }

    const env = options.env ?? buildCleanEnv()
    const timeoutMs = options.timeoutMs ?? 300_000

    const ac = options.abortController ?? new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)

    const chunks: string[] = []

    // The SDK checks process.env for nesting detection (e.g. CLAUDECODE=1).
    // Passing a clean env via options is not enough — must also clear process.env
    // so the SDK itself doesn't detect a nested session and hang.
    const savedEnv = clearNestingEnvVars()

    try {
      // 'all' means omit allowedTools so the SDK grants everything
      const tools = isAllTools(options.allowedTools) ? undefined : (options.allowedTools ?? [])

      const queryOpts: Record<string, unknown> = {
        maxTurns: options.maxTurns ?? 3,
        ...(tools !== undefined && { allowedTools: tools }),
        permissionMode: options.permissionMode ?? 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        cwd: options.cwd,
        env,
        abortController: ac,
        pathToClaudeCodeExecutable: resolveClaudeExecutable(),
      }

      if (options.model) queryOpts.model = options.model
      if (options.settingSources) queryOpts.settingSources = options.settingSources
      if (options.canUseTool) queryOpts.canUseTool = options.canUseTool

      for await (const message of query({ prompt, options: queryOpts })) {
        if (options.onMessage) options.onMessage(message)

        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) {
              chunks.push(block.text)
            }
          }
        }
      }
    } finally {
      restoreEnvVars(savedEnv)
      clearTimeout(timer)
    }

    return chunks.join('\n')
  },
}

/** Returns true if the env var key is a Claude nesting-related variable. */
function isClaudeNestingVar(key: string): boolean {
  return key.startsWith('CLAUDECODE') || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDE_PROJECT_DIR'
}

/** Build a filtered env stripping Claude-internal vars for the spawned process. */
function buildCleanEnv(): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (isClaudeNestingVar(key)) continue
    clean[key] = value
  }
  return clean
}

/** Temporarily clear nesting env vars from process.env so the SDK doesn't detect a nested session. */
function clearNestingEnvVars(): Record<string, string> {
  const saved: Record<string, string> = {}
  for (const key of Object.keys(process.env)) {
    if (isClaudeNestingVar(key) && process.env[key] !== undefined) {
      saved[key] = process.env[key]!
      delete process.env[key]
    }
  }
  return saved
}

/** Restore previously cleared env vars. */
function restoreEnvVars(saved: Record<string, string>): void {
  for (const [key, value] of Object.entries(saved)) {
    process.env[key] = value
  }
}
