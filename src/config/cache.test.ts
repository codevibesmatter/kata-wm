import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import jsYaml from 'js-yaml'
import { loadModesConfig, clearConfigCache } from './cache.js'

function makeTmpDir(label: string): string {
  const dir = join(
    os.tmpdir(),
    `wm-cache-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeModesYaml(dir: string, filename: string, config: Record<string, unknown>): string {
  const filePath = join(dir, filename)
  writeFileSync(filePath, jsYaml.dump(config))
  return filePath
}

describe('loadModesConfig 3-tier merge', () => {
  const origProjectDir = process.env.CLAUDE_PROJECT_DIR
  const origXdg = process.env.XDG_CONFIG_HOME
  let tmpDirs: string[] = []

  beforeEach(() => {
    clearConfigCache()
    tmpDirs = []
  })

  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    if (origProjectDir !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = origProjectDir
    } else {
      delete process.env.CLAUDE_PROJECT_DIR
    }
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
    clearConfigCache()
  })

  it('loads package config when no user or project overrides', async () => {
    // Point to nonexistent dirs so user/project layers are null
    const tmpDir = makeTmpDir('no-overrides')
    tmpDirs.push(tmpDir)
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')
    process.env.CLAUDE_PROJECT_DIR = join(tmpDir, 'noproj')
    mkdirSync(join(tmpDir, 'noproj', '.claude'), { recursive: true })

    const config = await loadModesConfig()
    // Should have package-level modes
    expect(config.modes.planning).toBeDefined()
    expect(config.modes.task).toBeDefined()
  })

  it('user modes merge over package modes', async () => {
    const tmpDir = makeTmpDir('user-merge')
    tmpDirs.push(tmpDir)

    // Create user modes.yaml with a custom mode
    const kataDir = join(tmpDir, 'kata')
    mkdirSync(kataDir, { recursive: true })
    writeModesYaml(kataDir, 'modes.yaml', {
      modes: {
        'custom-user-mode': {
          name: 'Custom User',
          description: 'A user-level mode',
          template: 'custom.md',
          category: 'management',
        },
      },
    })
    process.env.XDG_CONFIG_HOME = tmpDir

    // No project override
    const projDir = join(tmpDir, 'proj')
    mkdirSync(join(projDir, '.claude'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = projDir

    const config = await loadModesConfig()
    // User mode should appear
    expect(config.modes['custom-user-mode']).toBeDefined()
    expect(config.modes['custom-user-mode'].name).toBe('Custom User')
    // Package modes still present
    expect(config.modes.planning).toBeDefined()
  })

  it('project modes override user modes for same key', async () => {
    const tmpDir = makeTmpDir('project-wins')
    tmpDirs.push(tmpDir)

    // User defines task mode
    const kataDir = join(tmpDir, 'kata')
    mkdirSync(kataDir, { recursive: true })
    writeModesYaml(kataDir, 'modes.yaml', {
      modes: {
        task: {
          name: 'User Task',
          description: 'User version of task mode',
          template: 'task.md',
          category: 'implementation',
        },
      },
    })
    process.env.XDG_CONFIG_HOME = tmpDir

    // Project also defines task mode
    const projDir = join(tmpDir, 'proj')
    mkdirSync(join(projDir, '.claude', 'workflows'), { recursive: true })
    writeModesYaml(join(projDir, '.claude', 'workflows'), 'modes.yaml', {
      modes: {
        task: {
          name: 'Project Task',
          description: 'Project version of task mode',
          template: 'task.md',
          category: 'implementation',
        },
      },
    })
    process.env.CLAUDE_PROJECT_DIR = projDir

    const config = await loadModesConfig()
    // Project version wins
    expect(config.modes.task.name).toBe('Project Task')
  })

  it('all three tiers merge correctly', async () => {
    const tmpDir = makeTmpDir('three-tier')
    tmpDirs.push(tmpDir)

    // User adds a mode
    const kataDir = join(tmpDir, 'kata')
    mkdirSync(kataDir, { recursive: true })
    writeModesYaml(kataDir, 'modes.yaml', {
      modes: {
        'user-mode': {
          name: 'User Only',
          description: 'Only in user',
          template: 'user.md',
          category: 'management',
        },
      },
    })
    process.env.XDG_CONFIG_HOME = tmpDir

    // Project adds a different mode
    const projDir = join(tmpDir, 'proj')
    mkdirSync(join(projDir, '.claude', 'workflows'), { recursive: true })
    writeModesYaml(join(projDir, '.claude', 'workflows'), 'modes.yaml', {
      modes: {
        'project-mode': {
          name: 'Project Only',
          description: 'Only in project',
          template: 'proj.md',
          category: 'special',
        },
      },
    })
    process.env.CLAUDE_PROJECT_DIR = projDir

    const config = await loadModesConfig()
    // All three sources present
    expect(config.modes.planning).toBeDefined() // package
    expect(config.modes['user-mode']).toBeDefined() // user
    expect(config.modes['project-mode']).toBeDefined() // project
  })

  it('handles invalid user modes.yaml gracefully', async () => {
    const tmpDir = makeTmpDir('invalid-user')
    tmpDirs.push(tmpDir)

    const kataDir = join(tmpDir, 'kata')
    mkdirSync(kataDir, { recursive: true })
    writeFileSync(join(kataDir, 'modes.yaml'), 'this is not valid yaml: [[[{{{')
    process.env.XDG_CONFIG_HOME = tmpDir

    const projDir = join(tmpDir, 'proj')
    mkdirSync(join(projDir, '.claude'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = projDir

    // Should not throw, just skip user layer
    const config = await loadModesConfig()
    expect(config.modes.planning).toBeDefined()
  })
})
