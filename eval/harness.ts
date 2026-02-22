/**
 * Eval Harness — drives Claude through kata mode flows via the Claude Agent SDK.
 *
 * Uses @anthropic-ai/claude-agent-sdk which runs the same agent loop as Claude Code,
 * with real tool execution (Bash, Read, Write, Edit, etc.).
 *
 * settingSources: ['project'] loads .claude/settings.json which includes kata hooks
 * (SessionStart, UserPromptSubmit, Stop). Hooks fire naturally — no manual context
 * injection needed.
 *
 * Two project modes:
 *   - fresh: copy fixture to a persistent eval-projects/ dir (for onboarding tests)
 *   - existing: point at a real project dir (for iterative task/planning/impl tests)
 *
 * AskUserQuestion flow:
 *   When the agent calls AskUserQuestion, the canUseTool callback intercepts it with
 *   deny + interrupt (stops the agent loop) plus an abort controller safety net
 *   (kills the query if interrupt is ignored). The harness writes question + session_id
 *   to stdout and a structured .eval/pending-question.json file. The parent agent
 *   (running this as a background task) sees the output via TaskOutput, then resumes
 *   with: npx tsx eval/run.ts --resume=<session_id> --answer="..."
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionState } from '../src/state/schema.js'
import { judgeTranscript, saveJudgeArtifact } from './judge.js'
import type { JudgeResult } from './judge.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(__dirname, '../eval-fixtures')
const EVAL_PROJECTS_DIR = resolve(__dirname, '../eval-projects')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalCheckpoint {
  name: string
  assert: (ctx: EvalContext) => string | null | Promise<string | null>
}

export interface EvalScenario {
  id: string
  name: string
  /** User prompt sent to Claude */
  prompt: string
  checkpoints: EvalCheckpoint[]
  /** Max agent turns — omit to use the SDK default (no limit) */
  maxTurns?: number
  /** Timeout in ms (default: 10 min) */
  timeoutMs?: number
  /**
   * Fixture name under eval-fixtures/ to copy for fresh projects.
   * Default: 'tanstack-start'. Ignored when projectDir is set.
   */
  fixture?: string
  /**
   * Project directory to run against.
   * - If omitted, copies eval-fixtures/<fixture> to eval-projects/<id>-<timestamp>/
   * - If set, uses the existing directory as-is (for long-standing project evals)
   */
  projectDir?: string
  /**
   * Path to the mode template (.md with YAML frontmatter) for LLM judge review.
   * When set and judge is enabled, the transcript is reviewed against this template.
   */
  templatePath?: string
}

export interface EvalContext {
  projectDir: string
  getSessionState(): SessionState | null
  run(cmd: string): string
  fileExists(relativePath: string): boolean
  readFile(relativePath: string): string
  listDir(relativePath: string): string[]
}

export interface EvalResult {
  scenarioId: string
  scenarioName: string
  passed: boolean
  assertions: Array<{ name: string; passed: boolean; error?: string }>
  turns: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  projectDir: string
  sessionId?: string
  /** Set when the agent asked a question and the session was paused */
  pendingQuestion?: PendingQuestion
  transcriptPath?: string
  /** LLM judge review (only present when --judge is used) */
  judgeResult?: JudgeResult
  /** Path to saved judge review markdown */
  judgeReviewPath?: string
}

export interface PendingQuestion {
  sessionId: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect: boolean
  }>
}

export interface HarnessOptions {
  /** Stream agent messages to stdout as they arrive */
  verbose?: boolean
  /** Write full JSONL transcript to this path (auto-created dir if needed) */
  transcriptPath?: string
  /** Resume a paused session instead of starting a new one */
  resumeSessionId?: string
  /** Answer to provide when resuming (sent as the prompt) */
  resumeAnswer?: string
  /** Run LLM-as-judge review on the transcript after the scenario completes */
  judge?: boolean
  /** Provider name for the judge (default: 'claude') */
  judgeProvider?: string
  /** Override model for the judge provider */
  judgeModel?: string
  /** What `kata enter` printed (passed to judge for context) */
  enterOutput?: string
}

// ─── Harness ──────────────────────────────────────────────────────────────────

export async function runScenario(
  scenario: EvalScenario,
  options: HarnessOptions = {},
): Promise<EvalResult> {
  const startMs = Date.now()

  // Resolve project directory
  let projectDir: string
  if (scenario.projectDir) {
    projectDir = resolve(scenario.projectDir)
    if (!existsSync(projectDir)) {
      throw new Error(`Project directory does not exist: ${projectDir}`)
    }
  } else {
    const fixtureName = scenario.fixture ?? 'tanstack-start'
    const fixturePath = join(FIXTURES_DIR, fixtureName)
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture not found: ${fixturePath}`)
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    projectDir = join(EVAL_PROJECTS_DIR, `${scenario.id}-${ts}`)
    mkdirSync(projectDir, { recursive: true })
    cpSync(fixturePath, projectDir, { recursive: true })
    // Refresh templates with latest batteries so fixtures never go stale
    try {
      execSync(`kata batteries --update --cwd="${projectDir}"`, {
        cwd: projectDir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      const msg = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err)
      throw new Error(`kata batteries --update failed for fixture '${fixtureName}': ${msg}`)
    }
    // Initialize git repo so the inner agent has a working git context
    execSync(
      'git init -b main && ' +
      'git config user.email "eval@kata-wm.test" && ' +
      'git config user.name "Kata Eval" && ' +
      'git add -A && git commit -m "Initial scaffold"',
      { cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    // Set up a local bare remote so `git push` works for templates with changes_pushed
    const bareRemote = join(projectDir, '..', `${scenario.id}-remote.git`)
    execSync(`git init --bare "${bareRemote}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(`git remote add origin "${bareRemote}" && git push -u origin main`, {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  const result: EvalResult = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    passed: false,
    assertions: [],
    turns: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    projectDir,
  }

  if (options.transcriptPath) {
    mkdirSync(dirname(options.transcriptPath), { recursive: true })
    result.transcriptPath = options.transcriptPath
  }

  // Track pending question — set by canUseTool when AskUserQuestion fires.
  // The interrupt flag + abort controller guarantee the agent loop stops immediately.
  let pendingQuestion: PendingQuestion | null = null
  let sessionId: string | undefined
  const abortController = new AbortController()

  // SDK-native AskUserQuestion interception via canUseTool.
  // Returns deny + interrupt to immediately halt the agent loop, then aborts
  // the query as a safety net so the session cannot continue under any circumstance.
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (toolName !== 'AskUserQuestion') {
      return { behavior: 'allow' as const }
    }

    const questions = (input as { questions?: PendingQuestion['questions'] }).questions
    if (questions) {
      // Record question data. sessionId may not be set yet (race with init message
      // processing), so use a placeholder — we patch it after the loop ends.
      pendingQuestion = { sessionId: sessionId ?? '', questions }

      // Write to stdout so parent agent sees via TaskOutput
      process.stdout.write('\n[QUESTION] Agent needs input:\n')
      for (const q of questions) {
        process.stdout.write(`  ${q.header}: ${q.question}\n`)
        for (let i = 0; i < q.options.length; i++) {
          process.stdout.write(`    ${i + 1}. ${q.options[i].label} — ${q.options[i].description}\n`)
        }
      }
      if (sessionId) {
        process.stdout.write(`[QUESTION] session_id=${sessionId}\n`)
        process.stdout.write('[QUESTION] Resume with: --resume=<session_id> --answer="<answer>"\n\n')
      }
    }

    // Safety net: abort the query so it cannot continue even if interrupt is ignored.
    // Deferred to let the deny+interrupt response propagate first.
    setTimeout(() => abortController.abort(), 100)

    return {
      behavior: 'deny' as const,
      message: 'Session paused — awaiting external input.',
      interrupt: true,
    }
  }

  try {
    // Build clean env like cc-gateway: strip CLAUDECODE*, CLAUDE_CODE_ENTRYPOINT
    // so the spawned SDK process isn't blocked by nested-session guards.
    // Set CLAUDE_PROJECT_DIR to the inner project so kata commands resolve correctly.
    const cleanEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue
      if (key.startsWith('CLAUDECODE')) continue
      if (key === 'CLAUDE_CODE_ENTRYPOINT') continue
      if (key === 'CLAUDE_PROJECT_DIR') continue
      cleanEnv[key] = value
    }
    cleanEnv.CLAUDE_PROJECT_DIR = projectDir

    const isResume = !!options.resumeSessionId

    const queryOptions: Record<string, unknown> = {
      abortController,
      cwd: projectDir,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'AskUserQuestion'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project'],
      canUseTool,
      env: cleanEnv,
    }

    if (isResume) {
      queryOptions.resume = options.resumeSessionId
    } else if (scenario.maxTurns !== undefined) {
      queryOptions.maxTurns = scenario.maxTurns
    }

    const prompt = isResume
      ? (options.resumeAnswer ?? 'Continue.')
      : scenario.prompt

    // The for-await loop may end normally (agent finished) or via abort (AskUserQuestion
    // triggered the safety-net abort controller). Catch abort errors gracefully.
    try {
      for await (const message of query({ prompt, options: queryOptions })) {
        // Capture session ID from init message
        if (
          (message as { type: string; subtype?: string; session_id?: string }).type === 'system' &&
          (message as { subtype?: string }).subtype === 'init'
        ) {
          sessionId = (message as { session_id: string }).session_id
          result.sessionId = sessionId
        }

        // Write every event to transcript
        if (options.transcriptPath) {
          appendFileSync(
            options.transcriptPath,
            JSON.stringify({ ts: new Date().toISOString(), ...message }) + '\n',
          )
        }

        if (message.type === 'assistant') {
          result.turns++
          if (options.verbose) {
            emitAssistantMessage(result.turns, message)
          }
        } else if (message.type === 'user') {
          if (options.verbose) {
            emitToolResults(message)
          }
        } else if (message.type === 'result') {
          const modelUsage = Object.values(message.modelUsage ?? {})
          result.inputTokens = modelUsage.reduce(
            (s, u) => s + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens,
            0,
          )
          result.outputTokens = modelUsage.reduce((s, u) => s + u.outputTokens, 0)
          result.costUsd = message.total_cost_usd ?? 0
          if (options.verbose) {
            process.stdout.write(
              `\n[done] ${message.subtype} · ${result.turns} turns · $${result.costUsd.toFixed(4)}\n`,
            )
          }
        }
      }
    } catch (err) {
      // AbortError is expected when canUseTool triggers the safety-net abort.
      // Any other error is unexpected and should propagate.
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        abortController.signal.aborted
      if (!isAbort) throw err
      if (options.verbose) {
        process.stdout.write('[abort] Query aborted (AskUserQuestion safety net)\n')
      }
    }

    // If session was paused for a question, finalize and attach it to the result.
    // Patch sessionId if it wasn't available when canUseTool fired (race with init).
    if (pendingQuestion) {
      if (!pendingQuestion.sessionId && sessionId) {
        pendingQuestion.sessionId = sessionId
      }
      result.pendingQuestion = pendingQuestion

      // Write structured file now that we have the definitive sessionId
      const evalDir = join(projectDir, '.eval')
      mkdirSync(evalDir, { recursive: true })
      writeFileSync(
        join(evalDir, 'pending-question.json'),
        JSON.stringify(pendingQuestion, null, 2),
      )

      if (options.verbose) {
        process.stdout.write(`[paused] Session paused for AskUserQuestion. session_id=${pendingQuestion.sessionId}\n`)
      }
    }

    // Always run checkpoints — even when paused, state may already be written
    const ctx: EvalContext = buildContext(projectDir)
    for (const checkpoint of scenario.checkpoints) {
      const error = await checkpoint.assert(ctx)
      result.assertions.push({
        name: checkpoint.name,
        passed: error === null,
        error: error ?? undefined,
      })
    }
    result.passed = result.assertions.every((a) => a.passed)

    // LLM-as-judge — audit the pipeline
    if (options.judge && options.transcriptPath && scenario.templatePath) {
      try {
        if (options.verbose) {
          const pName = options.judgeProvider ?? 'claude'
          process.stdout.write(`\n[judge:${pName}] Running pipeline audit...\n`)
        }
        const resolvedTemplatePath = scenario.templatePath.startsWith('/')
          ? scenario.templatePath
          : join(projectDir, scenario.templatePath)
        const judgeResult = await judgeTranscript({
          transcriptPath: options.transcriptPath,
          templatePath: resolvedTemplatePath,
          enterOutput: options.enterOutput,
          providerName: options.judgeProvider,
          model: options.judgeModel,
        })
        result.judgeResult = judgeResult

        const reviewPath = saveJudgeArtifact(judgeResult, {
          scenarioId: scenario.id,
          transcriptPath: options.transcriptPath,
          templatePath: resolvedTemplatePath,
        })
        result.judgeReviewPath = reviewPath

        if (options.verbose) {
          process.stdout.write(
            `[judge] Agent: ${judgeResult.agentScore}/100 | ` +
            `System: ${judgeResult.systemScore}/100 | ` +
            `${judgeResult.verdict}\n`,
          )
          process.stdout.write(`[judge] Review: ${reviewPath}\n`)
        }
      } catch (err) {
        if (options.verbose) {
          process.stdout.write(
            `[judge] Failed: ${err instanceof Error ? err.message : String(err)}\n`,
          )
        }
      }
    }
  } finally {
    result.durationMs = Date.now() - startMs
    // No cleanup — projects persist for inspection and iteration
  }

  return result
}

// ─── Streaming output helpers ─────────────────────────────────────────────────

function emitAssistantMessage(turn: number, message: { message?: { content?: unknown[] } }): void {
  const content = message.message?.content ?? []
  for (const block of content as Array<{ type: string; text?: string; name?: string; input?: unknown }>) {
    if (block.type === 'text' && block.text) {
      const preview = block.text.slice(0, 300).replace(/\n/g, ' ')
      process.stdout.write(`[T${String(turn).padStart(3, '0')}] ${preview}\n`)
    } else if (block.type === 'tool_use') {
      const inputStr = formatToolInput(block.name ?? '', block.input)
      process.stdout.write(`[T${String(turn).padStart(3, '0')}] ▶ ${block.name}(${inputStr})\n`)
    }
  }
}

function emitToolResults(message: { message?: { content?: unknown[] } }): void {
  const content = message.message?.content ?? []
  for (const block of content as Array<{ type: string; content?: unknown[] | string; is_error?: boolean }>) {
    if (block.type === 'tool_result') {
      const raw =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? (block.content as Array<{ text?: string }>)
                .map((c) => c.text ?? '')
                .join('')
            : ''
      const preview = raw.slice(0, 200).replace(/\n/g, '↵')
      const tag = block.is_error ? '✗' : '✓'
      process.stdout.write(`       ${tag} ${preview}\n`)
    }
  }
}

function formatToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>

  if (name === 'Bash' && obj.command) return String(obj.command).slice(0, 120)
  if ((name === 'Read' || name === 'Write' || name === 'Edit') && obj.file_path)
    return String(obj.file_path)
  if (name === 'Glob' && obj.pattern) return String(obj.pattern)
  if (name === 'Grep' && obj.pattern) return String(obj.pattern)

  return JSON.stringify(input).slice(0, 80)
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(projectDir: string): EvalContext {
  return {
    projectDir,
    getSessionState(): SessionState | null {
      const sessionsDir = join(projectDir, '.claude', 'sessions')
      if (!existsSync(sessionsDir)) return null
      try {
        const sessions = readdirSync(sessionsDir)
        if (sessions.length === 0) return null
        const latest = sessions
          .map((id) => ({ id, path: join(sessionsDir, id, 'state.json') }))
          .filter(({ path }) => existsSync(path))
          .sort((a, b) => {
            const aTime = new Date(JSON.parse(readFileSync(a.path, 'utf-8')).updatedAt ?? 0).getTime()
            const bTime = new Date(JSON.parse(readFileSync(b.path, 'utf-8')).updatedAt ?? 0).getTime()
            return bTime - aTime
          })[0]
        if (!latest) return null
        return JSON.parse(readFileSync(latest.path, 'utf-8')) as SessionState
      } catch {
        return null
      }
    },
    run(cmd: string): string {
      try {
        return execSync(cmd, {
          cwd: projectDir,
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
      } catch (err) {
        return (err as { stdout?: string }).stdout ?? ''
      }
    },
    fileExists(rel: string): boolean {
      return existsSync(join(projectDir, rel))
    },
    readFile(rel: string): string {
      return readFileSync(join(projectDir, rel), 'utf-8')
    },
    listDir(rel: string): string[] {
      const abs = join(projectDir, rel)
      if (!existsSync(abs)) return []
      return readdirSync(abs)
    },
  }
}
