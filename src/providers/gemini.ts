/**
 * Gemini provider — wraps Google's Gemini CLI.
 *
 * Spawns `gemini` with --yolo for autonomous execution.
 * Prompt delivered via -p flag (stdin not supported by gemini CLI).
 * Based on: baseplane/packages/agent-tools/src/gemini/index.ts
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { AgentProvider, AgentRunOptions, ModelOption } from './types.js'
import { preparePrompt } from './prompt.js'

export const geminiProvider: AgentProvider = {
  name: 'gemini',
  defaultModel: undefined,
  models: [
    { id: 'gemini-3.1-pro-preview', description: 'Latest generation pro model (preview)' },
    { id: 'gemini-3-pro-preview', description: 'Gen 3 pro model (preview)' },
    { id: 'gemini-3-flash-preview', description: 'Gen 3 flash model (preview)' },
    { id: 'gemini-2.5-pro', description: 'Production pro model', default: true },
    { id: 'gemini-2.5-flash', description: 'Fast and efficient' },
    { id: 'gemini-2.5-flash-lite', description: 'Lightest and fastest' },
  ],

  async fetchModels(): Promise<ModelOption[]> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
    if (!apiKey) return this.models

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
      if (!res.ok) return this.models
      const data = (await res.json()) as { models: Array<{ name: string; displayName: string; description: string }> }
      return data.models
        .filter((m) => m.name.includes('gemini'))
        .map((m) => ({
          id: m.name.replace('models/', ''),
          description: m.displayName,
          default: m.name.includes('gemini-2.5-pro'),
        }))
    } catch {
      return this.models
    }
  },

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const model = options.model ?? this.defaultModel
    const timeoutMs = options.timeoutMs ?? 300_000

    // For large prompts, write to temp file then read back for -p delivery
    const prepared = preparePrompt(prompt, { thresholdChars: 0 })

    try {
      const promptText = prepared.filePath
        ? readFileSync(prepared.filePath, 'utf-8')
        : prompt

      const args = ['-p', promptText, '--yolo']
      if (model) args.push('-m', model)

      const result = spawnSync('gemini', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: timeoutMs,
        env: options.env ?? process.env as Record<string, string>,
      })

      if (result.error) {
        if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            'gemini CLI not found. Install: npm i -g @google/gemini-cli',
          )
        }
        throw new Error(`gemini: ${result.error.message}`)
      }

      if (result.status !== 0 && result.status !== null) {
        const stderr = result.stderr?.trim() || ''
        throw new Error(
          `gemini exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`,
        )
      }

      return result.stdout || ''
    } finally {
      prepared.cleanup()
    }
  },
}
