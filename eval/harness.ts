/**
 * Eval Harness — drives Claude through kata mode flows via the Claude Agent SDK.
 *
 * Uses @anthropic-ai/claude-agent-sdk which runs the same agent loop as Claude Code,
 * with real tool execution (Bash, Read, Write, Edit, etc.).
 *
 * Note: .claude/settings.json CLI hooks do NOT fire when using the SDK — the SDK
 * has its own in-process hook system. Kata context is injected via CLAUDE.md
 * (loaded via settingSources: ['project']) plus kata prime output appended to
 * the system prompt.
 *
 * Lifecycle per scenario:
 *   1. Copy fixture web app to a fresh temp directory
 *   2. Git init + initial commit in the temp project
 *   3. Run each checkpoint assertion against the evolved project state
 *   4. Return EvalResult with per-assertion pass/fail + token/cost stats
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { SessionState } from '../src/state/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../eval-fixtures/web-app')
const KATA_BIN = resolve(__dirname, '../kata')

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
}

export interface EvalContext {
  projectDir: string
  sessionId: string
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
}

// ─── Harness ──────────────────────────────────────────────────────────────────

export async function runScenario(scenario: EvalScenario): Promise<EvalResult> {
  const startMs = Date.now()
  const projectDir = join(tmpdir(), `kata-eval-${randomBytes(8).toString('hex')}`)

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
  }

  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'kata-eval',
    GIT_AUTHOR_EMAIL: 'eval@kata.test',
    GIT_COMMITTER_NAME: 'kata-eval',
    GIT_COMMITTER_EMAIL: 'eval@kata.test',
  }

  try {
    // ── 1. Copy fixture to temp dir ──────────────────────────────────────────
    cpSync(FIXTURE_PATH, projectDir, { recursive: true })

    // ── 2. Git init + initial commit ─────────────────────────────────────────
    execSync('git init && git add -A && git commit -m "chore: initial fixture"', {
      cwd: projectDir,
      env: GIT_ENV,
      stdio: 'pipe',
    })

    // ── 3. Build eval context ────────────────────────────────────────────────
    const ctx: EvalContext = buildContext(projectDir)

    // ── 4. Build system prompt appendage from kata prime ─────────────────────
    const kataContext = getKataContext(projectDir, ctx.sessionId)

    // ── 5. Run scenario via Agent SDK ────────────────────────────────────────
    // Unset CLAUDECODE so the spawned claude process isn't blocked by the
    // "cannot launch inside another Claude Code session" guard.
    const { CLAUDECODE: _cc, ...baseEnv } = process.env
    const agentEnv = { ...baseEnv, CLAUDE_PROJECT_DIR: projectDir, GIT_AUTHOR_NAME: 'kata-eval', GIT_AUTHOR_EMAIL: 'eval@kata.test', GIT_COMMITTER_NAME: 'kata-eval', GIT_COMMITTER_EMAIL: 'eval@kata.test' }

    for await (const message of query({
      prompt: scenario.prompt,
      options: {
        cwd: projectDir,
        ...(scenario.maxTurns !== undefined && { maxTurns: scenario.maxTurns }),
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
        permissionMode: 'acceptEdits',
        settingSources: ['project'],
        appendSystemPrompt: kataContext,
        env: agentEnv,
      },
    })) {
      if (message.type === 'assistant') {
        result.turns++
      } else if (message.type === 'result') {
        // Sum modelUsage for accurate totals (usage.input_tokens only counts
        // non-cached tokens; cached input is the majority in long sessions).
        const modelUsage = Object.values(message.modelUsage ?? {})
        result.inputTokens = modelUsage.reduce(
          (s, u) => s + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens,
          0,
        )
        result.outputTokens = modelUsage.reduce((s, u) => s + u.outputTokens, 0)
        result.costUsd = message.total_cost_usd ?? 0
      }
    }

    // ── 6. Run all checkpoints on final project state ─────────────────────────
    for (const checkpoint of scenario.checkpoints) {
      const error = await checkpoint.assert(ctx)
      result.assertions.push({
        name: checkpoint.name,
        passed: error === null,
        error: error ?? undefined,
      })
    }

    result.passed = result.assertions.every((a) => a.passed)
  } finally {
    result.durationMs = Date.now() - startMs
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }

  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildContext(projectDir: string): EvalContext {
  const sessionId = randomBytes(16)
    .toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')

  return {
    projectDir,
    sessionId,
    getSessionState(): SessionState | null {
      // SDK creates its own session; look for any session state file
      const sessionsDir = join(projectDir, '.claude', 'sessions')
      if (!existsSync(sessionsDir)) return null
      try {
        const sessions = readdirSync(sessionsDir)
        if (sessions.length === 0) return null
        // Use the most recently modified session
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

/**
 * Get kata context injection to append to the system prompt.
 * Tries kata prime first; falls back to a minimal kata summary.
 */
function getKataContext(projectDir: string, sessionId: string): string {
  const result = spawnSync(KATA_BIN, ['prime', `--session=${sessionId}`], {
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_SESSION_ID: sessionId },
    encoding: 'utf-8',
  })

  if (result.status === 0 && result.stdout?.trim()) {
    return result.stdout
  }

  // Minimal fallback
  return `
## kata Workflow Management

This project uses kata-wm. Always enter a mode before working:
  kata enter task          # For small focused changes (< 1 hour)
  kata enter planning      # For designing new features
  kata enter implementation --issue=N  # For implementing approved specs
  kata status              # Check current mode

Rules:
- NEVER skip mode entry
- Complete all tasks shown in TaskList before exiting
- Run kata can-exit to verify exit conditions are met
`.trim()
}
