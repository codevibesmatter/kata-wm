/**
 * Generic CLI provider — creates AgentProvider instances from YAML config.
 *
 * Supports any CLI that accepts a prompt and returns text output.
 * Provider plugins live in .kata/providers/{name}.yaml.
 *
 * YAML format:
 *   name: ollama
 *   command: ollama
 *   args: [run]                       # static args before model/prompt
 *   prompt_delivery: stdin             # stdin | flag
 *   prompt_flag: -p                    # only used when prompt_delivery: flag
 *   model_flag: --model               # how to pass model (null = positional after args)
 *   output_format: text               # text | jsonl
 *   bypass_flags: [--yolo]            # always appended for autonomous mode
 *   default_model: llama3.3
 *   models:
 *     - id: llama3.3
 *       description: Meta Llama 3.3
 *       default: true
 *   capabilities:
 *     tool_filtering: false
 *     max_turns: false
 *     text_only: true
 *     permission_bypass: always
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import jsYaml from 'js-yaml'
import { z } from 'zod'
import type { AgentProvider, AgentRunOptions, ModelOption, ProviderCapabilities } from './types.js'
import { isAllTools } from './types.js'

// ─── Schema ──────────────────────────────────────────────────────────────────

const CliProviderModelSchema = z.object({
  id: z.string(),
  description: z.string().optional().default(''),
  default: z.boolean().optional(),
})

const CliProviderConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  prompt_delivery: z.enum(['stdin', 'flag']).default('stdin'),
  prompt_flag: z.string().optional(),
  model_flag: z.string().nullable().optional(),
  output_format: z.enum(['text', 'jsonl']).default('text'),
  bypass_flags: z.array(z.string()).default([]),
  default_model: z.string().optional(),
  models: z.array(CliProviderModelSchema).default([]),
  capabilities: z.object({
    tool_filtering: z.boolean().default(false),
    max_turns: z.boolean().default(false),
    text_only: z.boolean().default(true),
    permission_bypass: z.enum(['sdk', 'cli-flag', 'always']).default('always'),
  }).default({}),
})

export type CliProviderConfig = z.infer<typeof CliProviderConfigSchema>

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an AgentProvider from a CLI provider config.
 */
export function createCliProvider(config: CliProviderConfig): AgentProvider {
  const capabilities: ProviderCapabilities = {
    toolFiltering: config.capabilities.tool_filtering,
    maxTurns: config.capabilities.max_turns,
    textOnly: config.capabilities.text_only,
    permissionBypass: config.capabilities.permission_bypass,
  }

  const models: ModelOption[] = config.models.map(m => ({
    id: m.id,
    description: m.description,
    default: m.default,
  }))

  return {
    name: config.name,
    defaultModel: config.default_model,
    models,
    capabilities,

    async run(prompt: string, options: AgentRunOptions): Promise<string> {
      const model = options.model ?? config.default_model
      const timeoutMs = options.timeoutMs ?? 300_000

      // Warn about unsupported per-tool filtering
      if (options.allowedTools?.length && !isAllTools(options.allowedTools) && !capabilities.toolFiltering) {
        process.stderr.write(
          `${config.name}: per-tool filtering not supported, running with default tool access\n`,
        )
      }

      // Build CLI args
      const args = [...config.args]

      // Add bypass flags
      args.push(...config.bypass_flags)

      // Add model
      if (model) {
        if (config.model_flag) {
          args.push(config.model_flag, model)
        } else if (config.model_flag === null || config.model_flag === undefined) {
          // null/undefined = positional arg
          args.push(model)
        }
      }

      // Add prompt via flag if configured
      if (config.prompt_delivery === 'flag' && config.prompt_flag) {
        args.push(config.prompt_flag, prompt)
      }

      if (config.output_format === 'jsonl') {
        return runJsonl(config.command, args, prompt, config.prompt_delivery, timeoutMs, options)
      }
      return runText(config.command, args, prompt, config.prompt_delivery, timeoutMs, options)
    },
  }
}

// ─── Runners ──────────────────────────────────────────────────────────────────

function runText(
  command: string,
  args: string[],
  prompt: string,
  delivery: 'stdin' | 'flag',
  timeoutMs: number,
  options: AgentRunOptions,
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: delivery === 'stdin' ? prompt : undefined,
    stdio: [delivery === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: options.env ?? process.env as Record<string, string>,
  })

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${command} not found. Is it installed and on PATH?`)
    }
    throw new Error(`${command}: ${result.error.message}`)
  }

  if (result.status !== 0 && result.status !== null) {
    const stderr = result.stderr?.trim() || ''
    throw new Error(
      `${command} exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`,
    )
  }

  return result.stdout || ''
}

function runJsonl(
  command: string,
  args: string[],
  prompt: string,
  delivery: 'stdin' | 'flag',
  timeoutMs: number,
  options: AgentRunOptions,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const proc = spawn(command, args, {
        env: options.env ?? process.env as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const messages: string[] = []
      let stdoutBuffer = ''
      let stderrBuffer = ''

      timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`${command}: timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      proc.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString()
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>
            if (msg.type === 'agent_message' && msg.content) {
              messages.push(msg.content as string)
            }
            if (msg.type === 'item.completed') {
              const item = msg.item as Record<string, unknown> | undefined
              if (item?.type === 'agent_message' && item.text) {
                messages.push(item.text as string)
              }
            }
          } catch { /* not JSON */ }
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString()
      })

      if (delivery === 'stdin') {
        proc.stdin?.write(prompt)
        proc.stdin?.end()
      }

      proc.on('error', (err) => {
        clearTimeout(timer)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`${command} not found. Is it installed and on PATH?`))
        } else {
          reject(new Error(`${command}: ${err.message}`))
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0 && code !== null) {
          const stderr = stderrBuffer.trim()
          reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr}` : ''}`))
          return
        }
        resolve(messages.join('\n'))
      })
    } catch (err) {
      if (timer) clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load all provider plugins from a directory.
 * Each .yaml file defines one CLI-based provider.
 */
export function loadProviderPlugins(dir: string): AgentProvider[] {
  if (!existsSync(dir)) return []

  const providers: AgentProvider[] = []

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue

    try {
      const raw = readFileSync(`${dir}/${file}`, 'utf-8')
      const parsed = jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA })
      const result = CliProviderConfigSchema.safeParse(parsed)

      if (!result.success) {
        const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
        process.stderr.write(`kata: invalid provider plugin ${file}: ${issues}\n`)
        continue
      }

      providers.push(createCliProvider(result.data))
    } catch (err) {
      process.stderr.write(`kata: failed to load provider plugin ${file}: ${err}\n`)
    }
  }

  return providers
}
