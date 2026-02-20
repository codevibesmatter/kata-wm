import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import jsYaml from 'js-yaml'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-canexit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Helper: capture console.log output from canExit()
 */
async function captureCanExit(args: string[]): Promise<string> {
  const { canExit } = await import('./can-exit.js')
  let captured = ''
  const origLog = console.log
  console.log = (...logArgs: unknown[]) => {
    captured += logArgs.map(String).join(' ')
  }
  try {
    await canExit(args)
  } finally {
    console.log = origLog
  }
  return captured
}

describe('canExit', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR
  const origSessionId = process.env.CLAUDE_SESSION_ID

  beforeEach(() => {
    tmpDir = makeTmpDir()
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.CLAUDE_SESSION_ID = '00000000-0000-0000-0000-000000000002'
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

  function createSessionState(state: Record<string, unknown>): void {
    const sessionId = process.env.CLAUDE_SESSION_ID!
    const sessionDir = join(tmpDir, '.claude', 'sessions', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify({
        sessionId,
        completedPhases: [],
        phases: [],
        modeHistory: [],
        modeState: {},
        beadsCreated: [],
        editedFiles: [],
        ...state,
      }),
    )
  }

  it('skips verification check when code_reviewer is not codex', async () => {
    // Write wm.yaml WITHOUT codex reviewer
    writeFileSync(
      join(tmpDir, '.claude', 'workflows', 'wm.yaml'),
      jsYaml.dump({
        reviews: {
          code_reviewer: null,
        },
      }),
    )

    createSessionState({
      sessionType: 'implementation',
      currentMode: 'implementation',
      issueNumber: 999,
    })

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }

    // Should NOT have "Verification not run" in reasons
    const hasVerificationReason = result.reasons.some(
      (r) => r.includes('Verification not run') || r.includes('Verification failed'),
    )
    expect(hasVerificationReason).toBe(false)
  })

  it('checks verification when code_reviewer is codex', async () => {
    writeFileSync(
      join(tmpDir, '.claude', 'workflows', 'wm.yaml'),
      jsYaml.dump({
        reviews: {
          code_reviewer: 'codex',
        },
      }),
    )

    createSessionState({
      sessionType: 'implementation',
      currentMode: 'implementation',
      issueNumber: 888,
    })

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }

    // Should have verification-related reason since no evidence file exists
    const hasVerificationReason = result.reasons.some(
      (r) => r.includes('Verification not run') || r.includes('Verification'),
    )
    expect(hasVerificationReason).toBe(true)
  })

  it('checks verification when code_reviewer is gemini', async () => {
    writeFileSync(
      join(tmpDir, '.claude', 'workflows', 'wm.yaml'),
      jsYaml.dump({
        reviews: {
          code_reviewer: 'gemini',
        },
      }),
    )

    createSessionState({
      sessionType: 'implementation',
      currentMode: 'implementation',
      issueNumber: 777,
    })

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }

    const hasVerificationReason = result.reasons.some((r) => r.includes('Verification'))
    expect(hasVerificationReason).toBe(true)
  })

  it('skips verification when code_review is explicitly false', async () => {
    writeFileSync(
      join(tmpDir, '.claude', 'workflows', 'wm.yaml'),
      jsYaml.dump({
        reviews: {
          code_reviewer: 'codex',
          code_review: false,
        },
      }),
    )

    createSessionState({
      sessionType: 'implementation',
      currentMode: 'implementation',
      issueNumber: 666,
    })

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }

    // code_review: false disables verification
    const hasVerificationReason = result.reasons.some((r) => r.includes('Verification'))
    expect(hasVerificationReason).toBe(false)
  })

  it('allows exit for freeform session type', async () => {
    createSessionState({
      sessionType: 'freeform',
      currentMode: 'freeform',
    })

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }
    expect(result.canExit).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('allows exit for qa session type', async () => {
    createSessionState({
      sessionType: 'qa',
      currentMode: 'qa',
    })

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }
    expect(result.canExit).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('verification passes when evidence file exists with passed: true', async () => {
    writeFileSync(
      join(tmpDir, '.claude', 'workflows', 'wm.yaml'),
      jsYaml.dump({
        reviews: {
          code_reviewer: 'codex',
        },
      }),
    )

    createSessionState({
      sessionType: 'implementation',
      currentMode: 'implementation',
      issueNumber: 555,
    })

    // Create passing evidence file
    const evidenceDir = join(tmpDir, '.claude', 'verification-evidence')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '555.json'),
      JSON.stringify({ passed: true, verifiedAt: new Date().toISOString() }),
    )

    const output = await captureCanExit(['--json', `--session=${process.env.CLAUDE_SESSION_ID}`])
    const result = JSON.parse(output) as { canExit: boolean; reasons: string[] }

    // No verification-related reason
    const hasVerificationReason = result.reasons.some((r) => r.includes('Verification'))
    expect(hasVerificationReason).toBe(false)
  })
})
