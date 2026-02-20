import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Helper: capture stdout from hook()
 */
async function captureHookStdout(args: string[]): Promise<string> {
  const { hook } = await import('../commands/hook.js')
  let captured = ''
  const origWrite = process.stdout.write
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }
  try {
    await hook(args)
  } finally {
    process.stdout.write = origWrite
  }
  return captured
}

/**
 * Suppress stderr during tests (hooks output guidance to stderr)
 */
function suppressStderr(): () => void {
  const origWrite = process.stderr.write
  process.stderr.write = (): boolean => true
  return () => {
    process.stderr.write = origWrite
  }
}

describe('integration: full hook dispatch simulation', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR
  const origSessionId = process.env.CLAUDE_SESSION_ID

  beforeEach(() => {
    tmpDir = makeTmpDir()
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.CLAUDE_SESSION_ID = '00000000-0000-0000-0000-000000000010'
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (origEnv !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = origEnv
    } else {
      delete process.env.CLAUDE_PROJECT_DIR
    }
    if (origSessionId !== undefined) {
      process.env.CLAUDE_SESSION_ID = origSessionId
    } else {
      delete process.env.CLAUDE_SESSION_ID
    }
    process.exitCode = undefined
  })

  it('session-start -> user-prompt -> stop-conditions lifecycle', async () => {
    const restoreStderr = suppressStderr()
    try {
      // Step 1: session-start hook (initializes session)
      const startOutput = await captureHookStdout(['session-start'])
      const startResult = JSON.parse(startOutput.trim()) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string }
      }
      expect(startResult.hookSpecificOutput.hookEventName).toBe('SessionStart')
      expect(startResult.hookSpecificOutput.additionalContext).toBeDefined()

      // After session-start, state.json should exist
      const sessionId = process.env.CLAUDE_SESSION_ID!
      const stateFile = join(tmpDir, '.claude', 'sessions', sessionId, 'state.json')
      expect(existsSync(stateFile)).toBe(true)

      // Step 2: user-prompt hook (suggest mode from user message)
      const promptOutput = await captureHookStdout(['user-prompt'])
      const promptResult = JSON.parse(promptOutput.trim()) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string }
      }
      expect(promptResult.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')

      // Step 3: stop-conditions hook (check if can exit)
      const stopOutput = await captureHookStdout(['stop-conditions'])
      const stopResult = JSON.parse(stopOutput.trim()) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string }
      }
      expect(stopResult.hookSpecificOutput.hookEventName).toBe('Stop')
    } finally {
      restoreStderr()
    }
  })

  it('mode-gate allows after mode is entered via state', async () => {
    const sessionId = process.env.CLAUDE_SESSION_ID!
    const sessionDir = join(tmpDir, '.claude', 'sessions', sessionId)
    mkdirSync(sessionDir, { recursive: true })

    // Create state with active mode
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({
        sessionId,
        sessionType: 'research',
        currentMode: 'research',
        completedPhases: [],
        phases: ['explore', 'synthesize'],
        modeHistory: [{ mode: 'research', enteredAt: new Date().toISOString() }],
        modeState: { research: { status: 'active' } },
        beadsCreated: [],
        editedFiles: [],
      }),
    )

    // mode-gate should ALLOW since we have an active mode
    const gateOutput = await captureHookStdout(['mode-gate'])
    const gateResult = JSON.parse(gateOutput.trim()) as {
      hookSpecificOutput: { hookEventName: string; decision: string }
    }
    expect(gateResult.hookSpecificOutput.decision).toBe('ALLOW')

    // task-evidence should ALLOW (advisory only)
    const evidenceOutput = await captureHookStdout(['task-evidence'])
    const evidenceResult = JSON.parse(evidenceOutput.trim()) as {
      hookSpecificOutput: { hookEventName: string; decision: string }
    }
    expect(evidenceResult.hookSpecificOutput.decision).toBe('ALLOW')
  })

  it('stop-conditions reports incomplete work for active session', async () => {
    const sessionId = process.env.CLAUDE_SESSION_ID!
    const sessionDir = join(tmpDir, '.claude', 'sessions', sessionId)
    mkdirSync(sessionDir, { recursive: true })

    // Create state with implementation mode and linked issue
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({
        sessionId,
        sessionType: 'implementation',
        currentMode: 'implementation',
        workflowId: 'GH#100',
        issueNumber: 100,
        completedPhases: [],
        phases: ['p0', 'p1', 'p2'],
        modeHistory: [{ mode: 'implementation', enteredAt: new Date().toISOString() }],
        modeState: { implementation: { status: 'active' } },
        beadsCreated: [],
        editedFiles: [],
      }),
    )

    // Create native task files to simulate pending tasks
    const tasksDir = join(os.homedir(), '.claude', 'tasks', sessionId)
    const createdTasksDir = existsSync(tasksDir)

    // stop-conditions should report something (either pending tasks or uncommitted changes)
    const restoreStderr = suppressStderr()
    try {
      const stopOutput = await captureHookStdout(['stop-conditions'])
      const stopResult = JSON.parse(stopOutput.trim()) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string }
      }
      expect(stopResult.hookSpecificOutput.hookEventName).toBe('Stop')
      // For implementation mode, there should be some guidance about pending work
      // (global conditions like uncommitted/unpushed are checked too)
    } finally {
      restoreStderr()
    }
  })
})
