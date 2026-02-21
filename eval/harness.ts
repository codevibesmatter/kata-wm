/**
 * Eval Harness — drives Claude through kata mode flows via the Anthropic API.
 *
 * Lifecycle per scenario:
 *   1. Copy fixture web app to a fresh temp directory
 *   2. Git init + initial commit in the temp project
 *   3. Spawn a kata session (kata init + set CLAUDE_PROJECT_DIR)
 *   4. Send the scenario prompt to Claude and drive a multi-turn conversation
 *   5. At each checkpoint, read session state + git log and collect evidence
 *   6. Return EvalResult with per-assertion pass/fail
 */

import Anthropic from '@anthropic-ai/sdk'
import { execSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { SessionState } from '../src/state/schema.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalCheckpoint {
  /** Descriptive name for this checkpoint */
  name: string
  /** Return null if passed, error message if failed */
  assert: (ctx: EvalContext) => string | null | Promise<string | null>
}

export interface EvalScenario {
  /** Unique scenario ID */
  id: string
  /** Human-readable name */
  name: string
  /** Initial user message sent to Claude */
  prompt: string
  /** Ordered list of assertions to run after each turn */
  checkpoints: EvalCheckpoint[]
  /** Max conversation turns before timeout (default: 20) */
  maxTurns?: number
  /** Max tokens to spend (default: 100k) */
  maxTokens?: number
  /** Timeout in ms (default: 5 minutes) */
  timeoutMs?: number
}

export interface EvalContext {
  /** Temp directory housing the project for this run */
  projectDir: string
  /** Current Claude session ID */
  sessionId: string
  /** Read session state from .claude/sessions/{sessionId}/state.json */
  getSessionState(): SessionState | null
  /** Run a command in the project dir, return output */
  run(cmd: string): string
  /** Check if a file exists relative to projectDir */
  fileExists(relativePath: string): boolean
  /** Read a file relative to projectDir */
  readFile(relativePath: string): string
  /** List files in a directory relative to projectDir */
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
}

// ─── Harness ──────────────────────────────────────────────────────────────────

const FIXTURE_PATH = resolve(new URL('.', import.meta.url).pathname, '../eval-fixtures/web-app')
const KATA_BIN = resolve(new URL('.', import.meta.url).pathname, '../kata')

/**
 * Run a single eval scenario end-to-end.
 */
export async function runScenario(scenario: EvalScenario): Promise<EvalResult> {
  const startMs = Date.now()
  const projectDir = join(tmpdir(), `kata-eval-${randomBytes(8).toString('hex')}`)
  const sessionId = randomBytes(16).toString('hex').replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    '$1-$2-$3-$4-$5',
  )

  const result: EvalResult = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    passed: false,
    assertions: [],
    turns: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  }

  try {
    // ── 1. Copy fixture to temp dir ──────────────────────────────────────────
    cpSync(FIXTURE_PATH, projectDir, { recursive: true })

    // ── 2. Git init + initial commit ─────────────────────────────────────────
    execSync('git init && git add -A && git commit -m "chore: initial fixture"', {
      cwd: projectDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'kata-eval',
        GIT_AUTHOR_EMAIL: 'eval@kata.test',
        GIT_COMMITTER_NAME: 'kata-eval',
        GIT_COMMITTER_EMAIL: 'eval@kata.test',
      },
      stdio: 'pipe',
    })

    // ── 3. Kata session init ─────────────────────────────────────────────────
    execSync(`"${KATA_BIN}" init --session=${sessionId}`, {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_SESSION_ID: sessionId },
      stdio: 'pipe',
    })

    // ── 4. Build eval context ────────────────────────────────────────────────
    const ctx: EvalContext = {
      projectDir,
      sessionId,
      getSessionState() {
        const statePath = join(projectDir, '.claude', 'sessions', sessionId, 'state.json')
        if (!existsSync(statePath)) return null
        try {
          return JSON.parse(readFileSync(statePath, 'utf-8')) as SessionState
        } catch {
          return null
        }
      },
      run(cmd: string): string {
        try {
          return execSync(cmd, {
            cwd: projectDir,
            env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_SESSION_ID: sessionId },
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim()
        } catch (err) {
          return (err as { stdout?: string; stderr?: string }).stdout ?? ''
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

    // ── 5. Drive Claude conversation ─────────────────────────────────────────
    const client = new Anthropic()
    const messages: Anthropic.MessageParam[] = []
    const systemPrompt = buildSystemPrompt(projectDir, sessionId)
    const maxTurns = scenario.maxTurns ?? 20
    const timeoutMs = scenario.timeoutMs ?? 5 * 60 * 1000
    const deadline = Date.now() + timeoutMs

    // Send initial prompt
    messages.push({ role: 'user', content: scenario.prompt })

    for (let turn = 0; turn < maxTurns && Date.now() < deadline; turn++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      })

      result.turns = turn + 1
      result.inputTokens += response.usage.input_tokens
      result.outputTokens += response.usage.output_tokens

      const assistantText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')

      messages.push({ role: 'assistant', content: assistantText })

      // Run all checkpoints after each assistant turn
      for (const checkpoint of scenario.checkpoints) {
        const already = result.assertions.find((a) => a.name === checkpoint.name)
        if (already?.passed) continue // already passed, skip

        const error = await checkpoint.assert(ctx)
        const idx = result.assertions.findIndex((a) => a.name === checkpoint.name)
        if (idx >= 0) {
          result.assertions[idx] = { name: checkpoint.name, passed: error === null, error: error ?? undefined }
        } else {
          result.assertions.push({ name: checkpoint.name, passed: error === null, error: error ?? undefined })
        }
      }

      // Stop if all checkpoints passed
      if (result.assertions.length === scenario.checkpoints.length &&
          result.assertions.every((a) => a.passed)) {
        break
      }

      // Check if Claude stopped naturally
      if (response.stop_reason === 'end_turn') {
        // Add a nudge to continue if not all checkpoints are done
        const allPassed = result.assertions.every((a) => a.passed)
        if (!allPassed) {
          messages.push({
            role: 'user',
            content: 'Please continue and complete the task.',
          })
        } else {
          break
        }
      }
    }

    // ── 6. Final checkpoint sweep ─────────────────────────────────────────────
    for (const checkpoint of scenario.checkpoints) {
      if (!result.assertions.find((a) => a.name === checkpoint.name)) {
        const error = await checkpoint.assert(ctx)
        result.assertions.push({ name: checkpoint.name, passed: error === null, error: error ?? undefined })
      }
    }

    result.passed = result.assertions.every((a) => a.passed)
  } finally {
    result.durationMs = Date.now() - startMs
    // Cleanup temp dir
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }

  return result
}

/**
 * Build system prompt with kata context injected.
 */
function buildSystemPrompt(projectDir: string, sessionId: string): string {
  // Try to get kata prime output for full context injection
  try {
    const primeOutput = spawnSync(
      KATA_BIN,
      ['prime', `--session=${sessionId}`],
      {
        cwd: projectDir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_SESSION_ID: sessionId },
        encoding: 'utf-8',
      },
    )
    if (primeOutput.status === 0 && primeOutput.stdout) {
      return primeOutput.stdout
    }
  } catch {
    // Fall through to minimal prompt
  }

  return `You are Claude Code, an AI coding assistant. You are working in a kata-wm managed project.
Project directory: ${projectDir}
Session ID: ${sessionId}

kata is a workflow management CLI. Use it to enter modes before working:
  kata enter task      # For small focused tasks
  kata enter planning  # For planning features
  kata status          # Check current mode

Always enter a mode before starting work.`
}
