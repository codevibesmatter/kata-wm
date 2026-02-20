import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-enter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Helper: capture console.log output from enter(), also suppressing stderr
 */
async function captureEnter(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { enter } = await import('./enter.js')
  let stdout = ''
  let stderr = ''
  const origLog = console.log
  const origError = console.error
  const origStderrWrite = process.stderr.write
  console.log = (...logArgs: unknown[]) => {
    stdout += logArgs.map(String).join(' ')
  }
  console.error = (...logArgs: unknown[]) => {
    stderr += logArgs.map(String).join(' ')
  }
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }
  try {
    await enter(args)
  } finally {
    console.log = origLog
    console.error = origError
    process.stderr.write = origStderrWrite
  }
  return { stdout, stderr }
}

describe('enter', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR
  const origSessionId = process.env.CLAUDE_SESSION_ID

  beforeEach(() => {
    tmpDir = makeTmpDir()
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.CLAUDE_SESSION_ID = '00000000-0000-0000-0000-000000000003'
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

  it('prints usage when no mode is provided', async () => {
    const { stderr } = await captureEnter([])
    expect(process.exitCode).toBe(1)
    expect(stderr).toContain('Usage:')
  })

  it('enters a mode and creates state (dry-run)', async () => {
    const { stdout } = await captureEnter([
      'freeform',
      '--dry-run',
      '--skip-cleanup',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    const result = JSON.parse(stdout) as {
      success: boolean
      mode: string
      action: string
      dryRun: boolean
    }

    expect(result.success).toBe(true)
    expect(result.mode).toBe('freeform')
    expect(result.action).toBe('dry-run')
    expect(result.dryRun).toBe(true)
  })

  it('enters research mode with phases', async () => {
    const { stdout } = await captureEnter([
      'research',
      '--dry-run',
      '--skip-cleanup',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    const result = JSON.parse(stdout) as {
      success: boolean
      mode: string
      phases: string[]
    }

    expect(result.success).toBe(true)
    expect(result.mode).toBe('research')
    expect(Array.isArray(result.phases)).toBe(true)
    expect(result.phases.length).toBeGreaterThan(0)
  })

  it('rejects unknown mode', async () => {
    const { stderr } = await captureEnter([
      'totally-nonexistent-mode',
      '--skip-cleanup',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    expect(process.exitCode).toBe(1)
    expect(stderr).toContain('Unknown mode')
  })

  it('rejects deprecated mode', async () => {
    // 'flow' is deprecated with redirect_to: freeform
    const { stderr } = await captureEnter([
      'flow',
      '--skip-cleanup',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    expect(process.exitCode).toBe(1)
    expect(stderr).toContain('deprecated')
  })

  it('generates issue-based workflow ID when --issue is provided', async () => {
    const { stdout } = await captureEnter([
      'freeform',
      '--dry-run',
      '--skip-cleanup',
      '--issue=42',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    const result = JSON.parse(stdout) as {
      success: boolean
      workflowId: string
      issueNumber: number
    }

    expect(result.success).toBe(true)
    expect(result.workflowId).toContain('GH#42')
    expect(result.issueNumber).toBe(42)
  })

  it('enters with custom template (dry-run)', async () => {
    // Create a simple custom template with valid phase ID format (p0, p1, p2...)
    const templatePath = join(tmpDir, 'my-template.md')
    writeFileSync(
      templatePath,
      `---
id: custom
name: "Custom Template"
phases:
  - id: p0
    name: "Step 1"
    task_config:
      title: "Do step 1"
  - id: p1
    name: "Step 2"
    task_config:
      title: "Do step 2"
---

# Custom Template

Instructions here.
`,
    )

    const { stdout } = await captureEnter([
      `--template=${templatePath}`,
      '--dry-run',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    const result = JSON.parse(stdout) as {
      success: boolean
      customTemplate: string
      phases: string[]
      dryRun: boolean
    }

    expect(result.success).toBe(true)
    expect(result.customTemplate).toBe(templatePath)
    expect(result.phases).toEqual(['p0', 'p1'])
    expect(result.dryRun).toBe(true)
  })

  it('spec_path from wm.yaml is respected', async () => {
    // Write wm.yaml with custom spec_path
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), 'spec_path: custom/specs\n')

    // The spec_path is used when enter tries to find a spec file for the issue.
    // We test that loading config works with the custom path.
    // Since there's no spec file at custom/specs, enter proceeds without spec phases.
    const { stdout } = await captureEnter([
      'freeform',
      '--dry-run',
      '--skip-cleanup',
      '--issue=99',
      `--session=${process.env.CLAUDE_SESSION_ID}`,
    ])

    const result = JSON.parse(stdout) as {
      success: boolean
      mode: string
      issueNumber: number
    }

    expect(result.success).toBe(true)
    expect(result.issueNumber).toBe(99)
  })
})
