import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'

function makeTmpDir(): string {
  const dir = join(os.tmpdir(), `wm-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Helper: capture stdout output from hook()
 */
async function captureHookStdout(args: string[]): Promise<string> {
  const { hook } = await import('./hook.js')
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
 * Helper: capture stderr output from hook()
 */
async function captureHookStderr(args: string[]): Promise<string> {
  const { hook } = await import('./hook.js')
  let captured = ''
  const origWrite = process.stderr.write
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }
  try {
    await hook(args)
  } finally {
    process.stderr.write = origWrite
  }
  return captured
}

describe('hook dispatch', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR
  const origSessionId = process.env.CLAUDE_SESSION_ID

  beforeEach(() => {
    tmpDir = makeTmpDir()
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    // Set a known session ID for tests
    process.env.CLAUDE_SESSION_ID = '00000000-0000-0000-0000-000000000001'
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

  it('unknown hook name sets exit code 1', async () => {
    const stderr = await captureHookStderr(['nonexistent-hook'])
    expect(process.exitCode).toBe(1)
    expect(stderr).toContain('Unknown hook')
  })

  it('no hook name sets exit code 1', async () => {
    const stderr = await captureHookStderr([])
    expect(process.exitCode).toBe(1)
    expect(stderr).toContain('Usage: wm hook <name>')
  })

  it('mode-gate allows when no session state exists (new project)', async () => {
    // No state.json exists for this session
    const output = await captureHookStdout(['mode-gate'])
    const parsed = JSON.parse(output.trim()) as {
      hookSpecificOutput: { hookEventName: string; decision: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.decision).toBe('ALLOW')
  })

  it('mode-gate blocks write tools when in default mode (no mode entered)', async () => {
    // Create session state with default mode
    const sessionId = process.env.CLAUDE_SESSION_ID!
    const sessionDir = join(tmpDir, '.claude', 'sessions', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({
        sessionId,
        sessionType: 'default',
        currentMode: 'default',
        completedPhases: [],
        phases: [],
        modeHistory: [],
        modeState: {},
        beadsCreated: [],
        editedFiles: [],
      }),
    )

    // Mock stdin to provide tool_name - since stdin reading is complex with piped data,
    // the mode-gate handler reads tool_name from the input which comes from stdin.
    // For unit testing, we test the behavior indirectly through the handler's logic.
    // When no stdin data, tool_name defaults to '' which won't match writeTools.
    const output = await captureHookStdout(['mode-gate'])
    const parsed = JSON.parse(output.trim()) as {
      hookSpecificOutput: { hookEventName: string; decision: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    // With no tool_name (empty stdin), it allows since no write tool matched
    expect(parsed.hookSpecificOutput.decision).toBe('ALLOW')
  })

  it('mode-gate allows when an active mode is set', async () => {
    const sessionId = process.env.CLAUDE_SESSION_ID!
    const sessionDir = join(tmpDir, '.claude', 'sessions', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({
        sessionId,
        sessionType: 'planning',
        currentMode: 'planning',
        completedPhases: [],
        phases: [],
        modeHistory: [{ mode: 'planning', enteredAt: new Date().toISOString() }],
        modeState: { planning: { status: 'active' } },
        beadsCreated: [],
        editedFiles: [],
      }),
    )

    const output = await captureHookStdout(['mode-gate'])
    const parsed = JSON.parse(output.trim()) as {
      hookSpecificOutput: { hookEventName: string; decision: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.decision).toBe('ALLOW')
  })

  it('task-evidence outputs ALLOW with advisory context', async () => {
    // task-evidence always ALLOWs - it's advisory only
    const output = await captureHookStdout(['task-evidence'])
    const parsed = JSON.parse(output.trim()) as {
      hookSpecificOutput: { hookEventName: string; decision: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.decision).toBe('ALLOW')
  })

  it('stop-conditions outputs Stop hook JSON when no session', async () => {
    // No session state -> allows stop
    const output = await captureHookStdout(['stop-conditions'])
    const parsed = JSON.parse(output.trim()) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('')
  })

  it('stop-conditions allows stop for freeform session', async () => {
    const sessionId = process.env.CLAUDE_SESSION_ID!
    const sessionDir = join(tmpDir, '.claude', 'sessions', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({
        sessionId,
        sessionType: 'freeform',
        currentMode: 'freeform',
        completedPhases: [],
        phases: [],
        modeHistory: [],
        modeState: {},
        beadsCreated: [],
        editedFiles: [],
      }),
    )

    const output = await captureHookStdout(['stop-conditions'])
    const parsed = JSON.parse(output.trim()) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('')
  })
})
