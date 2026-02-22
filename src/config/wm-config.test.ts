import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import jsYaml from 'js-yaml'
import { getDefaultConfig, loadWmConfig, type WmConfig } from './wm-config.js'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('getDefaultConfig', () => {
  it('returns correct default values', () => {
    const defaults = getDefaultConfig()
    expect(defaults.spec_path).toBe('planning/specs')
    expect(defaults.research_path).toBe('planning/research')
    expect(defaults.session_retention_days).toBe(7)
    expect(defaults.hooks_dir).toBe('.claude/hooks')
    expect(defaults.reviews).toBeDefined()
    expect(defaults.reviews!.spec_review).toBe(false)
    expect(defaults.reviews!.code_reviewer).toBeNull()
  })

  it('does not include project, mode_config, or hooks sections by default', () => {
    const defaults = getDefaultConfig()
    expect(defaults.project).toBeUndefined()
    expect(defaults.mode_config).toBeUndefined()
    expect(defaults.prime_extensions).toBeUndefined()
    expect(defaults.wm_version).toBeUndefined()
    expect(defaults.verify_command).toBeUndefined()
  })
})

describe('loadWmConfig', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR
  const origXdg = process.env.XDG_CONFIG_HOME

  beforeEach(() => {
    tmpDir = makeTmpDir()
    // Create .claude structure so findClaudeProjectDir finds this
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    // Set env var to point to our temp dir
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    // Point XDG to nonexistent dir to avoid user config interference
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'no-user-config')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (origEnv !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = origEnv
    } else {
      delete process.env.CLAUDE_PROJECT_DIR
    }
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  })

  it('returns defaults when wm.yaml does not exist', () => {
    const config = loadWmConfig()
    expect(config.spec_path).toBe('planning/specs')
    expect(config.research_path).toBe('planning/research')
    expect(config.session_retention_days).toBe(7)
  })

  it('reads wm.yaml and merges with defaults', () => {
    const wmConfig: WmConfig = {
      spec_path: 'custom/specs',
      research_path: 'custom/research',
      project: {
        name: 'test-project',
        test_command: 'bun test',
      },
    }
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    writeFileSync(wmYamlPath, jsYaml.dump(wmConfig))

    const config = loadWmConfig()
    expect(config.spec_path).toBe('custom/specs')
    expect(config.research_path).toBe('custom/research')
    expect(config.project!.name).toBe('test-project')
    expect(config.project!.test_command).toBe('bun test')
    // Defaults for missing fields
    expect(config.session_retention_days).toBe(7)
    expect(config.hooks_dir).toBe('.claude/hooks')
  })

  it('respects custom spec_path and research_path', () => {
    const wmConfig: WmConfig = {
      spec_path: 'docs/specifications',
      research_path: 'docs/research-findings',
    }
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    writeFileSync(wmYamlPath, jsYaml.dump(wmConfig))

    const config = loadWmConfig()
    expect(config.spec_path).toBe('docs/specifications')
    expect(config.research_path).toBe('docs/research-findings')
  })

  it('merges reviews section with defaults', () => {
    const wmConfig: WmConfig = {
      reviews: {
        code_reviewer: 'codex',
      },
    }
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    writeFileSync(wmYamlPath, jsYaml.dump(wmConfig))

    const config = loadWmConfig()
    // Custom value
    expect(config.reviews!.code_reviewer).toBe('codex')
    // Default for missing reviews field
    expect(config.reviews!.spec_review).toBe(false)
  })

  it('handles graceful upgrade from bare wm.yaml with missing sections', () => {
    // Minimal wm.yaml with only a project name, no reviews/mode_config/hooks sections
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    writeFileSync(
      wmYamlPath,
      `project:
  name: bare-project
`,
    )

    const config = loadWmConfig()
    expect(config.project!.name).toBe('bare-project')
    // All defaults should fill in
    expect(config.spec_path).toBe('planning/specs')
    expect(config.research_path).toBe('planning/research')
    expect(config.session_retention_days).toBe(7)
    expect(config.hooks_dir).toBe('.claude/hooks')
    expect(config.reviews!.spec_review).toBe(false)
    expect(config.reviews!.code_reviewer).toBeNull()
  })

  it('returns defaults for invalid YAML content', () => {
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    writeFileSync(wmYamlPath, 'this is not valid yaml: [[[{{{')

    const config = loadWmConfig()
    expect(config.spec_path).toBe('planning/specs')
    expect(config.session_retention_days).toBe(7)
  })

  it('returns defaults for empty wm.yaml', () => {
    const wmYamlPath = join(tmpDir, '.claude', 'workflows', 'wm.yaml')
    writeFileSync(wmYamlPath, '')

    const config = loadWmConfig()
    expect(config.spec_path).toBe('planning/specs')
    expect(config.session_retention_days).toBe(7)
  })
})

describe('loadWmConfig 3-tier merge', () => {
  let tmpDir: string
  const origEnv = process.env.CLAUDE_PROJECT_DIR
  const origXdg = process.env.XDG_CONFIG_HOME

  beforeEach(() => {
    tmpDir = makeTmpDir()
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (origEnv !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = origEnv
    } else {
      delete process.env.CLAUDE_PROJECT_DIR
    }
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  })

  it('user wm.yaml overrides defaults', () => {
    // Create user wm.yaml
    const userDir = join(tmpDir, 'user-config', 'kata')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'wm.yaml'), jsYaml.dump({
      session_retention_days: 30,
    }))
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'user-config')

    const config = loadWmConfig()
    expect(config.session_retention_days).toBe(30)
    // Other defaults still present
    expect(config.spec_path).toBe('planning/specs')
  })

  it('project wm.yaml overrides user wm.yaml', () => {
    // User sets retention to 30
    const userDir = join(tmpDir, 'user-config', 'kata')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'wm.yaml'), jsYaml.dump({
      session_retention_days: 30,
      spec_path: 'user/specs',
    }))
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'user-config')

    // Project sets retention to 14
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), jsYaml.dump({
      session_retention_days: 14,
    }))

    const config = loadWmConfig()
    // Project wins for retention
    expect(config.session_retention_days).toBe(14)
    // User wins for spec_path (not overridden by project)
    expect(config.spec_path).toBe('user/specs')
  })

  it('user project key is ignored', () => {
    const userDir = join(tmpDir, 'user-config', 'kata')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'wm.yaml'), jsYaml.dump({
      project: {
        name: 'user-project-name',
        test_command: 'user-test',
      },
    }))
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'user-config')

    const config = loadWmConfig()
    // User project key should be ignored
    expect(config.project).toBeUndefined()
  })

  it('project project key is preserved', () => {
    const userDir = join(tmpDir, 'user-config', 'kata')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'wm.yaml'), jsYaml.dump({
      project: { name: 'user-name' },
    }))
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'user-config')

    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), jsYaml.dump({
      project: { name: 'project-name', test_command: 'npm test' },
    }))

    const config = loadWmConfig()
    expect(config.project!.name).toBe('project-name')
    expect(config.project!.test_command).toBe('npm test')
  })

  it('reviews section shallow merges across tiers', () => {
    const userDir = join(tmpDir, 'user-config', 'kata')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'wm.yaml'), jsYaml.dump({
      reviews: { code_reviewer: 'gemini' },
    }))
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'user-config')

    // Project overrides spec_review but not code_reviewer
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), jsYaml.dump({
      reviews: { spec_review: true },
    }))

    const config = loadWmConfig()
    expect(config.reviews!.code_reviewer).toBe('gemini') // from user
    expect(config.reviews!.spec_review).toBe(true) // from project
  })

  it('prime_extensions array replaces entirely', () => {
    const userDir = join(tmpDir, 'user-config', 'kata')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'wm.yaml'), jsYaml.dump({
      prime_extensions: ['user-ext-1', 'user-ext-2'],
    }))
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'user-config')

    // Project replaces entirely
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), jsYaml.dump({
      prime_extensions: ['project-ext'],
    }))

    const config = loadWmConfig()
    expect(config.prime_extensions).toEqual(['project-ext'])
  })

  it('handles missing user config dir gracefully', () => {
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    writeFileSync(join(tmpDir, '.claude', 'workflows', 'wm.yaml'), jsYaml.dump({
      spec_path: 'custom/specs',
    }))

    const config = loadWmConfig()
    expect(config.spec_path).toBe('custom/specs')
    expect(config.session_retention_days).toBe(7) // default
  })
})
