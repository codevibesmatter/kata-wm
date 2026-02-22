/**
 * LLM-as-judge for eval transcripts.
 *
 * Feeds the transcript + template + enter output to an agent provider.
 * The agent writes a free-form pipeline audit.
 * We extract three values: agent score, system score, verdict.
 * The full review is saved as markdown.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentProvider } from '../src/providers/types.js'
import { getProvider } from '../src/providers/index.js'
import { loadPrompt } from '../src/providers/prompt.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Types ───────────────────────────────────────────────────────────────────

export type Verdict = 'PASS' | 'FAIL_AGENT' | 'FAIL_SYSTEM' | 'FAIL_BOTH'

export interface JudgeResult {
  agentScore: number
  systemScore: number
  verdict: Verdict
  review: string
  provider?: string
  model?: string
}

export interface JudgeOptions {
  transcriptPath: string
  templatePath: string
  enterOutput?: string
  maxTranscriptLines?: number
  /** Provider name (default: 'claude') */
  providerName?: string
  /** Override model for the provider */
  model?: string
}

// ─── Prompt Construction ─────────────────────────────────────────────────────

function loadReviewPrompt(): string {
  // Try saved prompt from providers/prompts/ first, fall back to local
  try {
    return loadPrompt('transcript-review')
  } catch {
    const promptPath = join(__dirname, 'prompts', 'transcript-review.md')
    if (!existsSync(promptPath)) {
      throw new Error(`Review prompt not found: ${promptPath}`)
    }
    return readFileSync(promptPath, 'utf-8')
  }
}

function summarizeTranscript(transcriptPath: string, maxLines: number): string {
  if (!existsSync(transcriptPath)) {
    return '[No transcript file found]'
  }

  const raw = readFileSync(transcriptPath, 'utf-8')
  const lines = raw.trim().split('\n').filter(Boolean)
  const events: string[] = []

  for (const line of lines) {
    try {
      const event = JSON.parse(line)

      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            events.push(`[assistant] ${block.text.slice(0, 500)}`)
          } else if (block.type === 'tool_use') {
            const inputStr = JSON.stringify(block.input ?? {}).slice(0, 300)
            events.push(`[tool_call] ${block.name}(${inputStr})`)
          }
        }
      } else if (event.type === 'user' && event.message?.content) {
        for (const block of event.message.content as Array<{ type: string; content?: unknown }>) {
          if (block.type === 'tool_result') {
            const text =
              typeof block.content === 'string'
                ? block.content.slice(0, 200)
                : Array.isArray(block.content)
                  ? (block.content as Array<{ text?: string }>)
                      .map((c) => c.text ?? '')
                      .join('')
                      .slice(0, 200)
                  : ''
            if (text) events.push(`[tool_result] ${text}`)
          }
        }
      }
    } catch {
      // Skip malformed lines
    }

    if (events.length >= maxLines) break
  }

  return events.join('\n')
}

function buildJudgePrompt(options: JudgeOptions): string {
  const reviewPrompt = loadReviewPrompt()
  const template = existsSync(options.templatePath)
    ? readFileSync(options.templatePath, 'utf-8')
    : '[Template not found]'
  const transcript = summarizeTranscript(
    options.transcriptPath,
    options.maxTranscriptLines ?? 500,
  )
  const enterOutput = options.enterOutput ?? '[No enter output captured]'

  return `${reviewPrompt}

---

## Mode Template

\`\`\`markdown
${template}
\`\`\`

## Enter Output (what the agent was told on mode entry)

\`\`\`
${enterOutput}
\`\`\`

## Session Transcript

\`\`\`
${transcript}
\`\`\`

Now audit this session against the pipeline. Write your analysis, then end with exactly these three lines:

AGENT_SCORE: {number}/100
SYSTEM_SCORE: {number}/100
VERDICT: {PASS|FAIL_AGENT|FAIL_SYSTEM|FAIL_BOTH}`
}

// ─── Response Parsing (minimal) ──────────────────────────────────────────────

export function extractScore(text: string, label: string): number {
  const match = text.match(new RegExp(`${label}:\\s*(\\d+)/100`))
  return match ? parseInt(match[1], 10) : 0
}

export function extractVerdict(text: string): Verdict {
  const match = text.match(/VERDICT:\s*(PASS|FAIL_AGENT|FAIL_SYSTEM|FAIL_BOTH)/)
  if (match) return match[1] as Verdict

  const agent = extractScore(text, 'AGENT_SCORE')
  const system = extractScore(text, 'SYSTEM_SCORE')
  if (agent >= 75 && system >= 75) return 'PASS'
  if (agent < 75 && system < 75) return 'FAIL_BOTH'
  if (system < 75) return 'FAIL_SYSTEM'
  return 'FAIL_AGENT'
}

// ─── Judge Execution ─────────────────────────────────────────────────────────

export async function judgeTranscript(options: JudgeOptions): Promise<JudgeResult> {
  const prompt = buildJudgePrompt(options)
  const providerName = options.providerName ?? 'claude'

  // Clean env so agent subprocesses aren't blocked by nested-session guards
  const cleanEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('CLAUDECODE')) continue
    if (key === 'CLAUDE_CODE_ENTRYPOINT') continue
    if (key === 'CLAUDE_PROJECT_DIR') continue
    cleanEnv[key] = value
  }

  const provider: AgentProvider = getProvider(providerName)
  const review = await provider.run(prompt, {
    cwd: dirname(options.transcriptPath),
    model: options.model,
    env: cleanEnv,
  })

  return {
    agentScore: extractScore(review, 'AGENT_SCORE'),
    systemScore: extractScore(review, 'SYSTEM_SCORE'),
    verdict: extractVerdict(review),
    review,
    provider: providerName,
    model: options.model ?? provider.defaultModel,
  }
}

// ─── Artifact ────────────────────────────────────────────────────────────────

export function saveJudgeArtifact(
  result: JudgeResult,
  options: JudgeOptions & { scenarioId: string; outputDir?: string },
): string {
  const outputDir = options.outputDir ?? join(__dirname, '..', 'eval-reviews')
  mkdirSync(outputDir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  // Review as readable markdown
  const mdPath = join(outputDir, `${options.scenarioId}-${ts}.md`)
  writeFileSync(mdPath, result.review + '\n')

  // Structured summary as JSON (additive — provider/model fields added)
  const jsonPath = join(outputDir, `${options.scenarioId}-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify({
    scenarioId: options.scenarioId,
    agentScore: result.agentScore,
    systemScore: result.systemScore,
    verdict: result.verdict,
    provider: result.provider,
    model: result.model,
    judgedAt: new Date().toISOString(),
    transcriptPath: options.transcriptPath,
    templatePath: options.templatePath,
    reviewPath: mdPath,
  }, null, 2) + '\n')

  return mdPath
}
