import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { getUserConfigDir, getModesYamlPath, resolveTemplatePath, resolveSpecTemplatePath } from './lookup.js'

function makeTmpDir(label: string): string {
  const dir = join(
    os.tmpdir(),
    `wm-lookup-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('getUserConfigDir', () => {
  const origXdg = process.env.XDG_CONFIG_HOME
  const origHome = process.env.HOME

  afterEach(() => {
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
    if (origHome !== undefined) {
      process.env.HOME = origHome
    } else {
      delete process.env.HOME
    }
  })

  it('uses XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config'
    expect(getUserConfigDir()).toBe('/custom/config/kata')
  })

  it('falls back to ~/.config/kata when XDG_CONFIG_HOME is not set', () => {
    delete process.env.XDG_CONFIG_HOME
    const result = getUserConfigDir()
    expect(result).toMatch(/\.config\/kata$/)
  })

  it('returns path without creating directory', () => {
    const tmpDir = makeTmpDir('xdg')
    process.env.XDG_CONFIG_HOME = tmpDir
    const configDir = getUserConfigDir()
    expect(configDir).toBe(join(tmpDir, 'kata'))
    // Directory should NOT exist (getUserConfigDir doesn't create it)
    const { existsSync } = require('node:fs')
    expect(existsSync(configDir)).toBe(false)
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('getModesYamlPath', () => {
  const origProjectDir = process.env.CLAUDE_PROJECT_DIR
  const origXdg = process.env.XDG_CONFIG_HOME

  afterEach(() => {
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
  })

  it('returns packagePath always', () => {
    const paths = getModesYamlPath()
    expect(paths.packagePath).toMatch(/modes\.yaml$/)
  })

  it('returns userPath when user modes.yaml exists', () => {
    const tmpDir = makeTmpDir('user-modes')
    const kataDir = join(tmpDir, 'kata')
    mkdirSync(kataDir, { recursive: true })
    writeFileSync(join(kataDir, 'modes.yaml'), 'modes: {}')
    process.env.XDG_CONFIG_HOME = tmpDir

    const paths = getModesYamlPath()
    expect(paths.userPath).toBe(join(kataDir, 'modes.yaml'))

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null userPath when user config dir does not exist', () => {
    const tmpDir = makeTmpDir('no-user')
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    const paths = getModesYamlPath()
    expect(paths.userPath).toBeNull()

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns projectPath when project modes.yaml exists', () => {
    const tmpDir = makeTmpDir('project-modes')
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, '.claude', 'workflows'), { recursive: true })
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'modes.yaml'), 'modes: {}')
    process.env.CLAUDE_PROJECT_DIR = tmpDir

    const paths = getModesYamlPath()
    expect(paths.projectPath).toBe(join(tmpDir, '.claude', 'workflows', 'modes.yaml'))

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null projectPath when project modes.yaml does not exist', () => {
    const tmpDir = makeTmpDir('no-project')
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir

    const paths = getModesYamlPath()
    expect(paths.projectPath).toBeNull()

    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('resolveTemplatePath', () => {
  const origProjectDir = process.env.CLAUDE_PROJECT_DIR
  const origXdg = process.env.XDG_CONFIG_HOME
  let tmpDirs: string[] = []

  afterEach(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
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
  })

  it('resolves project-level template first', () => {
    const tmpDir = makeTmpDir('proj-tmpl')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'workflows', 'templates'), { recursive: true })
    writeFileSync(join(tmpDir, '.claude', 'workflows', 'templates', 'task.md'), '# project task')
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    // Also create user-level to prove project wins
    const userDir = makeTmpDir('user-tmpl-proj')
    tmpDirs.push(userDir)
    mkdirSync(join(userDir, 'kata', 'templates'), { recursive: true })
    writeFileSync(join(userDir, 'kata', 'templates', 'task.md'), '# user task')
    process.env.XDG_CONFIG_HOME = userDir

    const result = resolveTemplatePath('task.md')
    expect(result).toBe(join(tmpDir, '.claude', 'workflows', 'templates', 'task.md'))
  })

  it('falls back to user-level template when project lacks it', () => {
    const tmpDir = makeTmpDir('no-proj-tmpl')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    // Create user template
    const userDir = makeTmpDir('user-tmpl')
    tmpDirs.push(userDir)
    mkdirSync(join(userDir, 'kata', 'templates'), { recursive: true })
    writeFileSync(join(userDir, 'kata', 'templates', 'custom.md'), '# user custom')
    process.env.XDG_CONFIG_HOME = userDir

    const result = resolveTemplatePath('custom.md')
    expect(result).toBe(join(userDir, 'kata', 'templates', 'custom.md'))
  })

  it('falls back to package batteries template', () => {
    const tmpDir = makeTmpDir('pkg-fallback')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    // task.md exists in batteries/templates/ (package level)
    const result = resolveTemplatePath('task.md')
    expect(result).toMatch(/batteries\/templates\/task\.md$/)
  })

  it('throws when template not found at any tier', () => {
    const tmpDir = makeTmpDir('not-found')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    expect(() => resolveTemplatePath('does-not-exist.md')).toThrow('Template not found')
  })

  it('resolves absolute paths directly', () => {
    const tmpDir = makeTmpDir('abs-path')
    tmpDirs.push(tmpDir)
    const absPath = join(tmpDir, 'absolute.md')
    writeFileSync(absPath, '# absolute')

    const result = resolveTemplatePath(absPath)
    expect(result).toBe(absPath)
  })
})

describe('resolveSpecTemplatePath', () => {
  const origProjectDir = process.env.CLAUDE_PROJECT_DIR
  const origXdg = process.env.XDG_CONFIG_HOME
  let tmpDirs: string[] = []

  afterEach(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
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
  })

  it('resolves project-level spec template first', () => {
    const tmpDir = makeTmpDir('proj-spec')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    mkdirSync(join(tmpDir, 'planning', 'spec-templates'), { recursive: true })
    writeFileSync(join(tmpDir, 'planning', 'spec-templates', 'feature.md'), '# project feature')
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    const result = resolveSpecTemplatePath('feature.md')
    expect(result).toBe(join(tmpDir, 'planning', 'spec-templates', 'feature.md'))
  })

  it('falls back to user-level spec template', () => {
    const tmpDir = makeTmpDir('user-spec')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    const userDir = makeTmpDir('user-spec-dir')
    tmpDirs.push(userDir)
    mkdirSync(join(userDir, 'kata', 'spec-templates'), { recursive: true })
    writeFileSync(join(userDir, 'kata', 'spec-templates', 'custom.md'), '# user custom')
    process.env.XDG_CONFIG_HOME = userDir

    const result = resolveSpecTemplatePath('custom.md')
    expect(result).toBe(join(userDir, 'kata', 'spec-templates', 'custom.md'))
  })

  it('falls back to package batteries spec template', () => {
    const tmpDir = makeTmpDir('pkg-spec')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    // feature.md exists in batteries/spec-templates/
    const result = resolveSpecTemplatePath('feature.md')
    expect(result).toMatch(/batteries\/spec-templates\/feature\.md$/)
  })

  it('throws when spec template not found at any tier', () => {
    const tmpDir = makeTmpDir('spec-not-found')
    tmpDirs.push(tmpDir)
    mkdirSync(join(tmpDir, '.claude', 'sessions'), { recursive: true })
    process.env.CLAUDE_PROJECT_DIR = tmpDir
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'nonexistent')

    expect(() => resolveSpecTemplatePath('nonexistent.md')).toThrow('Spec template not found')
  })
})
