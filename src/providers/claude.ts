/**
 * Claude provider — wraps @anthropic-ai/claude-agent-sdk query().
 *
 * Uses the Agent SDK's streaming query with no tools (text-only judge).
 * The SDK picks its own default model when none is specified.
 */

import type { AgentProvider, AgentRunOptions, ModelOption, ThinkingLevel } from './types.js'

const claudeThinking: ThinkingLevel[] = [
  { id: 'disabled', description: 'No extended thinking' },
  { id: 'enabled', description: 'Extended thinking enabled (budget tokens via API)' },
]

export const claudeProvider: AgentProvider = {
  name: 'claude',
  defaultModel: undefined,
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

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)

    const chunks: string[] = []

    try {
      for await (const message of query({
        prompt,
        options: {
          maxTurns: 3,
          allowedTools: [] as string[],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          cwd: options.cwd,
          env,
          ...(options.model ? { model: options.model } : {}),
          abortController: ac,
        },
      })) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) {
              chunks.push(block.text)
            }
          }
        }
      }
    } finally {
      clearTimeout(timer)
    }

    return chunks.join('\n')
  },
}

/** Build a filtered env stripping Claude-internal vars. */
function buildCleanEnv(): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('CLAUDECODE')) continue
    if (key === 'CLAUDE_CODE_ENTRYPOINT') continue
    if (key === 'CLAUDE_PROJECT_DIR') continue
    clean[key] = value
  }
  return clean
}
