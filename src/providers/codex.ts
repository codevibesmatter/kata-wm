/**
 * Codex provider — wraps OpenAI's Codex CLI.
 *
 * Spawns `codex exec` with the prompt via stdin, parses JSONL output
 * for agent messages. Uses --sandbox read-only by default.
 * Based on: baseplane/packages/agent-tools/src/codex/runner.ts
 */

import { spawn } from 'node:child_process'
import type { AgentProvider, AgentRunOptions } from './types.js'

export const codexProvider: AgentProvider = {
  name: 'codex',
  defaultModel: 'gpt-5.2-codex',

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const model = options.model ?? this.defaultModel ?? 'gpt-5.2-codex'
    const timeoutMs = options.timeoutMs ?? 300_000

    const args = [
      'exec',
      '--sandbox', 'read-only',
      '--json',
      '--skip-git-repo-check',
      '--cd', options.cwd,
      '-c', `model="${model}"`,
      '-',  // read prompt from stdin
    ]

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
