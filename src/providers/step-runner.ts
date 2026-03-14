/**
 * General-purpose agent step runner.
 *
 * Invokes an AgentProvider with a named prompt template and assembled context.
 * Used by: template agent steps, `kata review` CLI, and (future) eval judge refactor.
 *
 * Context sources are named strings that get resolved to content:
 *   - git_diff: `git diff <diff_base>...HEAD`
 *   - template: current mode template markdown
 *   - session_notes: {mode}-notes.md from session dir
 *   - spec: spec file content (reads spec_path from wm.yaml)
 *   - transcript: session transcript (JSONL, summarized)
 *   - file:{path}: arbitrary file content
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentStepConfig } from '../validation/schemas.js'
import { loadKataConfig } from '../config/kata-config.js'
import { getProvider } from './index.js'
import { loadPrompt } from './prompt.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepContext {
  /** Working directory (project root) */
  cwd: string
  /** Session directory path (for notes, state) */
  sessionDir?: string
  /** Current mode name */
  mode?: string
  /** Template file path */
  templatePath?: string
  /** Spec file path (overrides wm.yaml lookup) */
  specPath?: string
  /** Transcript file path (for summarization) */
  transcriptPath?: string
  /** Pre-cleaned environment for provider subprocess */
  env?: Record<string, string>
  /** Pre-assembled markdown sections appended after named context sources */
  extraContext?: string
}

export interface StepRunResult {
  /** Raw text output from the agent */
  output: string
  /** Extracted score (if prompt includes scoring format) */
  score?: number
  /** True if score >= threshold or no gate configured */
  passed: boolean
  /** Path where output artifact was saved (if output configured) */
  artifactPath?: string
  /** Provider name used */
  provider: string
  /** Model used */
  model?: string
}

// ─── Context Assembly ─────────────────────────────────────────────────────────

function resolveProvider(providerRef: string): string {
  // Support ${providers.default} and ${providers.code_reviewer} syntax
  const match = providerRef.match(/^\$\{providers\.(\w+)\}$/)
  if (match) {
    const config = loadKataConfig()
    const key = match[1]
    if (key === 'default') return config.providers?.default ?? 'claude'
    if (key === 'code_reviewer') return config.reviews?.code_reviewer ?? 'claude'
    if (key === 'spec_reviewer') return config.reviews?.spec_reviewer ?? config.providers?.default ?? 'claude'
    if (key === 'judge_provider') return config.providers?.judge_provider ?? 'claude'
    return providerRef // unrecognized key, pass through
  }
  return providerRef
}

function assembleContext(sources: string[], ctx: StepContext): string {
  const sections: string[] = []

  for (const source of sources) {
    if (source === 'git_diff') {
      const config = loadKataConfig()
      const diffBase = config.project?.diff_base ?? 'origin/main'
      try {
        const diff = execSync(`git diff ${diffBase}...HEAD`, {
          cwd: ctx.cwd,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024, // 1MB
          timeout: 10_000,
        })
        if (diff.trim()) {
          sections.push(`## Git Diff (${diffBase}...HEAD)\n\n\`\`\`diff\n${diff.slice(0, 50_000)}\n\`\`\``)
        }
      } catch {
        sections.push(`## Git Diff\n\n[Could not compute diff against ${diffBase}]`)
      }
    } else if (source === 'template') {
      if (ctx.templatePath && existsSync(ctx.templatePath)) {
        const content = readFileSync(ctx.templatePath, 'utf-8')
        sections.push(`## Mode Template\n\n\`\`\`markdown\n${content}\n\`\`\``)
      }
    } else if (source === 'session_notes') {
      if (ctx.sessionDir && ctx.mode) {
        const notesPath = join(ctx.sessionDir, `${ctx.mode}-notes.md`)
        if (existsSync(notesPath)) {
          const content = readFileSync(notesPath, 'utf-8')
          sections.push(`## Session Notes\n\n${content}`)
        }
      }
    } else if (source === 'spec') {
      const specPath = ctx.specPath ?? findSpecFile(ctx.cwd)
      if (specPath && existsSync(specPath)) {
        const content = readFileSync(specPath, 'utf-8')
        sections.push(`## Spec\n\n\`\`\`markdown\n${content}\n\`\`\``)
      }
    } else if (source === 'transcript') {
      if (ctx.transcriptPath && existsSync(ctx.transcriptPath)) {
        const content = readFileSync(ctx.transcriptPath, 'utf-8')
        // Truncate transcript to ~500 lines for context budget
        const lines = content.split('\n').slice(0, 500)
        sections.push(`## Transcript\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``)
      }
    } else if (source.startsWith('file:')) {
      const filePath = source.slice(5)
      const resolved = filePath.startsWith('/') ? filePath : join(ctx.cwd, filePath)
      if (existsSync(resolved)) {
        const content = readFileSync(resolved, 'utf-8')
        sections.push(`## File: ${filePath}\n\n\`\`\`\n${content.slice(0, 50_000)}\n\`\`\``)
      }
    }
  }

  return sections.join('\n\n---\n\n')
}

function findSpecFile(cwd: string): string | null {
  const config = loadKataConfig()
  const specDir = join(cwd, config.spec_path ?? 'planning/specs')
  if (!existsSync(specDir)) return null
  try {
    const files = execSync(`ls -t "${specDir}"/*.md 2>/dev/null`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5_000,
    })
    const first = files.trim().split('\n')[0]
    return first || null
  } catch {
    return null
  }
}

// ─── Score Extraction ─────────────────────────────────────────────────────────

export function extractScore(text: string, label: string): number | undefined {
  const match = text.match(new RegExp(`${label}:\\s*(\\d+)/100`))
  return match ? Number.parseInt(match[1], 10) : undefined
}

// ─── Artifact Saving ──────────────────────────────────────────────────────────

function saveArtifact(output: string, outputPath: string, cwd: string, meta: Record<string, unknown>): string {
  // Replace {date} placeholder
  const date = new Date().toISOString().slice(0, 10)
  const resolved = outputPath.replace(/{date}/g, date)
  const fullPath = resolved.startsWith('/') ? resolved : join(cwd, resolved)

  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, output + '\n')

  // Write companion JSON metadata
  const jsonPath = fullPath.replace(/\.md$/, '.json')
  writeFileSync(jsonPath, JSON.stringify({
    ...meta,
    createdAt: new Date().toISOString(),
    reviewPath: fullPath,
  }, null, 2) + '\n')

  return fullPath
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

export async function runAgentStep(
  config: AgentStepConfig,
  context: StepContext,
): Promise<StepRunResult> {
  // 1. Resolve provider name (may be a ${} reference)
  const providerName = resolveProvider(config.provider)
  const provider = getProvider(providerName)

  // 2. Load prompt template
  const promptTemplate = loadPrompt(config.prompt)

  // 3. Assemble context from named sources + extra context
  const namedContext = config.context?.length
    ? assembleContext(config.context, context)
    : ''
  const assembledContext = [namedContext, context.extraContext]
    .filter(Boolean)
    .join('\n\n---\n\n')

  // 4. Build final prompt
  const fullPrompt = assembledContext
    ? `${promptTemplate}\n\n---\n\n${assembledContext}`
    : promptTemplate

  // 5. Clean environment for subprocess
  const env = context.env ?? cleanEnv()

  // 6. Run the provider
  const output = await provider.run(fullPrompt, {
    cwd: context.cwd,
    model: config.model,
    env,
    ...(config.allowed_tools && { allowedTools: config.allowed_tools }),
    ...(config.max_turns && { maxTurns: config.max_turns }),
    ...(config.timeout && { timeoutMs: config.timeout * 1000 }),
  })

  // 7. Extract score if applicable
  const score = extractScore(output, 'SCORE') ?? extractScore(output, 'AGENT_SCORE')
  const threshold = config.threshold ?? 75
  const passed = config.gate ? (score !== undefined && score >= threshold) : true

  // 8. Save artifact if configured
  let artifactPath: string | undefined
  if (config.output) {
    artifactPath = saveArtifact(output, config.output, context.cwd, {
      provider: providerName,
      model: config.model ?? provider.defaultModel,
      prompt: config.prompt,
      gate: config.gate,
      threshold: config.gate ? threshold : undefined,
      score,
      passed,
    })
  }

  return {
    output,
    score,
    passed,
    artifactPath,
    provider: providerName,
    model: config.model ?? provider.defaultModel,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('CLAUDECODE')) continue
    if (key === 'CLAUDE_CODE_ENTRYPOINT') continue
    if (key === 'CLAUDE_PROJECT_DIR') continue
    env[key] = value
  }
  return env
}
