/**
 * Codex provider — wraps OpenAI's Codex CLI.
 *
 * Spawns `codex exec` with the prompt via stdin, parses JSONL output
 * for agent messages. Uses --dangerously-bypass-approvals-and-sandbox for full autonomy.
 * Based on: baseplane/packages/agent-tools/src/codex/runner.ts
 */

import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AgentProvider, AgentRunOptions, ModelOption, ThinkingLevel } from './types.js'

const codexThinking: ThinkingLevel[] = [
  { id: 'low', description: 'Fast responses with lighter reasoning' },
  { id: 'medium', description: 'Balances speed and reasoning depth' },
  { id: 'high', description: 'Greater reasoning depth for complex problems' },
  { id: 'xhigh', description: 'Extra high reasoning depth' },
]

export const codexProvider: AgentProvider = {
  name: 'codex',
  defaultModel: undefined,
  models: [
    { id: 'gpt-5.3-codex', description: 'Latest frontier agentic coding model', default: true, thinkingLevels: codexThinking },
    { id: 'gpt-5.3-codex-spark', description: 'Ultra-fast coding model' },
    { id: 'gpt-5.2-codex', description: 'Frontier agentic coding model', thinkingLevels: codexThinking },
    { id: 'gpt-5.1-codex-max', description: 'Codex-optimized flagship for deep and fast reasoning', thinkingLevels: codexThinking },
    { id: 'gpt-5.1-codex', description: 'Optimized for codex', thinkingLevels: codexThinking },
    { id: 'gpt-5.2', description: 'Latest frontier model with improvements across knowledge, reasoning and coding', thinkingLevels: codexThinking },
    { id: 'gpt-5.1', description: 'Broad world knowledge with strong general reasoning', thinkingLevels: codexThinking },
    { id: 'gpt-5-codex', description: 'Optimized for codex', thinkingLevels: codexThinking },
    { id: 'gpt-5', description: 'Broad world knowledge with strong general reasoning', thinkingLevels: codexThinking },
    { id: 'gpt-5.1-codex-mini', description: 'Optimized for codex, cheaper, faster' },
    { id: 'gpt-5-codex-mini', description: 'Optimized for codex, cheaper, faster' },
  ],

  async fetchModels(): Promise<ModelOption[]> {
    const cachePath = join(homedir(), '.codex', 'models_cache.json')
    if (!existsSync(cachePath)) return this.models

    try {
      const raw = readFileSync(cachePath, 'utf-8')
      const data = JSON.parse(raw) as { models: Array<{
        slug: string; display_name: string; description: string; priority: number
        supported_reasoning_levels?: Array<{ effort: string; description: string }>
      }> }
      const first = data.models[0]?.slug
      return data.models.map((m) => ({
        id: m.slug,
        description: m.description,
        default: m.slug === first,
        ...(m.supported_reasoning_levels?.length ? {
          thinkingLevels: m.supported_reasoning_levels.map((r) => ({
            id: r.effort,
            description: r.description,
          })),
        } : {}),
      }))
    } catch {
      return this.models
    }
  },

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const model = options.model ?? this.defaultModel
    const timeoutMs = options.timeoutMs ?? 300_000

    const args = [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--cd', options.cwd,
    ]
    if (model) args.push('--model', model)
    args.push('-')  // read prompt from stdin

    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      try {
        const proc = spawn('codex', args, {
          env: { ...(options.env ?? process.env), TERM: 'dumb' } as Record<string, string>,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        const agentMessages: string[] = []
        let stdoutBuffer = ''
        let stderrBuffer = ''

        timer = setTimeout(() => {
          proc.kill('SIGTERM')
          reject(new Error(`codex: timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        proc.stdout?.on('data', (data: Buffer) => {
          stdoutBuffer += data.toString()

          // Process complete JSONL lines
          const lines = stdoutBuffer.split('\n')
          stdoutBuffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            try {
              const msg = JSON.parse(trimmed) as Record<string, unknown>

              // Extract agent responses
              if (msg.type === 'agent_message') {
                const content = msg.content as string
                if (content) agentMessages.push(content)
              }

              // Also extract from item.completed events
              if (msg.type === 'item.completed') {
                const item = msg.item as Record<string, unknown> | undefined
                if (item?.type === 'agent_message') {
                  const text = item.text as string
                  if (text) agentMessages.push(text)
                }
              }
            } catch {
              // Non-JSON output, skip
            }
          }
        })

        proc.stderr?.on('data', (data: Buffer) => {
          stderrBuffer += data.toString()
        })

        // Send prompt to stdin
        proc.stdin?.write(prompt)
        proc.stdin?.end()

        proc.on('error', (err) => {
          clearTimeout(timer)
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error('codex CLI not found. Install: npm i -g @openai/codex'))
          } else {
            reject(new Error(`codex: ${err.message}`))
          }
        })

        proc.on('close', (code) => {
          clearTimeout(timer)

          // Process remaining stdout buffer
          if (stdoutBuffer.trim()) {
            try {
              const msg = JSON.parse(stdoutBuffer.trim()) as Record<string, unknown>
              if (msg.type === 'agent_message' && msg.content) {
                agentMessages.push(msg.content as string)
              }
            } catch {
              // Not JSON
            }
          }

          if (code !== 0 && code !== null) {
            const stderr = stderrBuffer.trim()
            reject(new Error(
              `codex exited with code ${code}${stderr ? `: ${stderr}` : ''}`,
            ))
            return
          }

          resolve(agentMessages.join('\n'))
        })
      } catch (err) {
        if (timer) clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  },
}
