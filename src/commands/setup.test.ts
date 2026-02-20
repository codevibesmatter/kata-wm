import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import jsYaml from 'js-yaml'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Helper: capture stdout from setup()
 */
async function captureSetup(args: string[], cwd: string): Promise<string> {
  const { setup } = await import('./setup.js')
  let captured = ''
  const origWrite = process.stdout.write
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }
  try {
    await setup([...args, `--cwd=${cwd}`])
  } finally {
    process.stdout.write = origWrite
  }
  return captured
}

describe('setup --yes', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR

  beforeEach(() => {
    tmpDir = makeTmpDir()
    // The setup command uses --cwd to determine target directory.
    // Set CLAUDE_PROJECT_DIR so findClaudeProjectDir resolves correctly after setup.
    process.env.CLAUDE_PROJECT_DIR = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (origEnv !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = origEnv
    } else {
      delete process.env.CLAUDE_PROJECT_DIR
    }
  })

  it('creates directories and wm.yaml with default profile', async () => {
    const output = await captureSetup(['--yes'], tmpDir)

    // Check output indicates success
    expect(output).toContain('wm setup complete')

    // Check wm.yaml was created
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    expect(existsSync(wmYamlPath)).toBe(true)

    // Parse and verify wm.yaml content
    const raw = readFileSync(wmYamlPath, 'utf-8')
    const config = jsYaml.load(raw) as Record<string, unknown>
    expect(config).toBeDefined()
    expect(config.spec_path).toBe('planning/specs')
    expect(config.research_path).toBe('planning/research')

    // Check sessions directory was created
    expect(existsSync(join(tmpDir, '.claude', 'sessions'))).toBe(true)
  })

  it('creates settings.json with 3 default hooks', async () => {
    await captureSetup(['--yes'], tmpDir)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    expect(existsSync(settingsPath)).toBe(true)

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks: Record<string, unknown[]>
    }
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.SessionStart).toBeDefined()
    expect(settings.hooks.UserPromptSubmit).toBeDefined()
    expect(settings.hooks.Stop).toBeDefined()
  })

  it('--strict adds 3 PreToolUse hooks', async () => {
    await captureSetup(['--yes', '--strict'], tmpDir)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks: Record<string, unknown[]>
    }

    // Should have PreToolUse hooks
    expect(settings.hooks.PreToolUse).toBeDefined()
    expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true)
    // mode-gate + task-deps + task-evidence = 3 entries
    expect(settings.hooks.PreToolUse.length).toBe(3)
  })

  it('is idempotent (re-run preserves existing)', async () => {
    // First setup
    await captureSetup(['--yes'], tmpDir)

    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    const firstContent = readFileSync(wmYamlPath, 'utf-8')

    // Second setup
    await captureSetup(['--yes'], tmpDir)

    const secondContent = readFileSync(wmYamlPath, 'utf-8')
    // Content should be the same (or updated wm_version only)
    const firstConfig = jsYaml.load(firstContent) as Record<string, unknown>
    const secondConfig = jsYaml.load(secondContent) as Record<string, unknown>
    expect(secondConfig.spec_path).toBe(firstConfig.spec_path)
    expect(secondConfig.research_path).toBe(firstConfig.research_path)
  })

  it('preserves existing non-wm hooks', async () => {
    // Create a pre-existing settings.json with non-wm hooks
    // Use a command that does NOT match the wm hook pattern
    // (the pattern matches '\bhook (session-start|...)' so 'my-custom-hook session-start' would match)
    mkdirSync(join(tmpDir, '.claude'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'my-custom-startup-script --init',
                },
              ],
            },
          ],
        },
      }),
    )

    await captureSetup(['--yes'], tmpDir)

    const settingsPath = join(tmpDir, '.claude', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    // Should have both custom hook and wm hook for SessionStart
    const sessionStartEntries = settings.hooks.SessionStart
    expect(sessionStartEntries.length).toBeGreaterThanOrEqual(2)

    // Custom hook should be preserved
    const hasCustomHook = sessionStartEntries.some((entry) =>
      entry.hooks?.some((h) => h.command === 'my-custom-startup-script --init'),
    )
    expect(hasCustomHook).toBe(true)

    // wm hook should be present
    const hasWmHook = sessionStartEntries.some((entry) =>
      entry.hooks?.some((h) => h.command.includes('hook session-start')),
    )
    expect(hasWmHook).toBe(true)
  })

  it('works without .claude/sessions/ existing', async () => {
    // Don't pre-create .claude/sessions/ - setup should create it
    const output = await captureSetup(['--yes'], tmpDir)
    expect(output).toContain('wm setup complete')
    expect(existsSync(join(tmpDir, '.claude', 'sessions'))).toBe(true)
  })

  it('auto-detects package.json name and test command', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'my-detected-project',
        scripts: { test: 'vitest run' },
      }),
    )

    const output = await captureSetup(['--yes'], tmpDir)
    expect(output).toContain('my-detected-project')
    expect(output).toContain('vitest run')
  })

  it('auto-detects CI config', async () => {
    mkdirSync(join(tmpDir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(tmpDir, '.github', 'workflows', 'ci.yml'), 'name: CI')

    const output = await captureSetup(['--yes'], tmpDir)
    expect(output).toContain('github-actions')
  })
})

describe('setup interactive template', () => {
  it('setup template has 6 phases with AskUserQuestion steps', async () => {
    // Read the setup template to verify it has the expected structure
    const { parseYamlFrontmatter } = await import('../yaml/parser.js')
    const { getPackageRoot } = await import('../session/lookup.js')

    const templatePath = join(getPackageRoot(), 'templates', 'setup.md')
    const frontmatter = parseYamlFrontmatter<{
      phases: Array<{ id: string; tasks: string[] }>
    }>(templatePath)

    expect(frontmatter).not.toBeNull()
    expect(frontmatter!.phases).toHaveLength(6)

    // Verify phases have AskUserQuestion steps
    const allTasks = frontmatter!.phases.flatMap((p) => p.tasks || [])
    const askQuestionTasks = allTasks.filter((t) => t.includes('AskUserQuestion'))
    expect(askQuestionTasks.length).toBeGreaterThan(0)
  })
})
