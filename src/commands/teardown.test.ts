import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-teardown-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Helper: capture stdout from teardown()
 */
async function captureTeardown(args: string[], cwd: string): Promise<string> {
  const { teardown } = await import('./teardown.js')
  let captured = ''
  const origWrite = process.stdout.write
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }
  try {
    await teardown([...args, `--cwd=${cwd}`])
  } finally {
    process.stdout.write = origWrite
  }
  return captured
}

describe('teardown', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR

  beforeEach(() => {
    tmpDir = makeTmpDir()
    process.env.CLAUDE_PROJECT_DIR = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (origEnv !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = origEnv
    } else {
      delete process.env.CLAUDE_PROJECT_DIR
    }
    process.exitCode = undefined
  })

  /**
   * Create a fully configured wm project at tmpDir
   */
  function createWmProject(): void {
    mkdirSync(join(tmpDir, '.claude', 'sessions', 'some-session'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })

    // Write wm.yaml
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), 'spec_path: planning/specs\n')

    // Write settings.json with wm hooks and a non-wm hook
    writeFileSync(
      join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'my-custom-tool session-start',
                  },
                ],
              },
              {
                hooks: [
                  {
                    type: 'command',
                    command: '"/some/path/wm" hook session-start',
                  },
                ],
              },
            ],
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: '"/some/path/wm" hook user-prompt',
                  },
                ],
              },
            ],
            Stop: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: '"/some/path/wm" hook stop-conditions',
                    timeout: 30,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    )
  }

  it('removes wm hooks from settings.json', async () => {
    createWmProject()

    await captureTeardown(['--yes'], tmpDir)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    expect(existsSync(settingsPath)).toBe(true)

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, unknown[]>
    }

    // wm hooks should be removed
    expect(settings.hooks?.UserPromptSubmit).toBeUndefined()
    expect(settings.hooks?.Stop).toBeUndefined()

    // SessionStart should only have the custom hook (not the wm one)
    if (settings.hooks?.SessionStart) {
      const entries = settings.hooks.SessionStart as Array<{
        hooks: Array<{ command: string }>
      }>
      expect(entries).toHaveLength(1)
      expect(entries[0].hooks[0].command).toBe('my-custom-tool session-start')
    }
  })

  it('preserves non-wm hooks', async () => {
    createWmProject()

    await captureTeardown(['--yes'], tmpDir)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    // Custom hook should still be there
    const sessionStartEntries = settings.hooks?.SessionStart
    expect(sessionStartEntries).toBeDefined()
    expect(sessionStartEntries).toHaveLength(1)
    expect(sessionStartEntries![0].hooks[0].command).toBe('my-custom-tool session-start')
  })

  it('deletes wm.yaml', async () => {
    createWmProject()
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    expect(existsSync(wmYamlPath)).toBe(true)

    await captureTeardown(['--yes'], tmpDir)

    expect(existsSync(wmYamlPath)).toBe(false)
  })

  it('preserves sessions/', async () => {
    createWmProject()
    const sessionsDir = join(tmpDir, '.claude', 'sessions')
    expect(existsSync(sessionsDir)).toBe(true)

    await captureTeardown(['--yes'], tmpDir)

    // Sessions should still exist
    expect(existsSync(sessionsDir)).toBe(true)
    expect(existsSync(join(sessionsDir, 'some-session'))).toBe(true)
  })

  it('is idempotent on project without wm', async () => {
    // Create a project with no wm config
    mkdirSync(join(tmpDir, '.claude'), { recursive: true })

    const output = await captureTeardown(['--yes'], tmpDir)
    expect(output).toContain('Nothing to teardown')
  })

  it('is idempotent when run twice', async () => {
    createWmProject()

    // First teardown
    await captureTeardown(['--yes'], tmpDir)

    // Second teardown should be a no-op
    const output = await captureTeardown(['--yes'], tmpDir)
    expect(output).toContain('Nothing to teardown')
  })

  it('dry-run shows planned actions without making changes', async () => {
    createWmProject()
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')

    const output = await captureTeardown(['--yes', '--dry-run'], tmpDir)
    expect(output).toContain('[DRY RUN]')
    expect(output).toContain('No changes made')

    // Files should still exist
    expect(existsSync(wmYamlPath)).toBe(true)
  })

  it('requires --yes to confirm (exits with code 1 without it)', async () => {
    createWmProject()

    const output = await captureTeardown([], tmpDir)
    expect(output).toContain('--yes to confirm')
    expect(process.exitCode).toBe(1)

    // Files should still exist
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    expect(existsSync(wmYamlPath)).toBe(true)
  })
})
