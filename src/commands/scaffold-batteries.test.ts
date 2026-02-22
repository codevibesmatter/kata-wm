import { describe, it, expect, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { scaffoldUserBatteries } from './scaffold-batteries.js'

function makeTmpDir(label: string): string {
  const dir = join(
    os.tmpdir(),
    `wm-scaffold-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('scaffoldUserBatteries', () => {
  const origXdg = process.env.XDG_CONFIG_HOME
  let tmpDirs: string[] = []

  afterEach(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
    if (origXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  })

  it('creates templates and spec-templates in user config dir', () => {
    const tmpDir = makeTmpDir('user-batt')
    tmpDirs.push(tmpDir)
    process.env.XDG_CONFIG_HOME = tmpDir

    const result = scaffoldUserBatteries()

    // Should have seeded templates
    expect(result.templates.length).toBeGreaterThan(0)
    expect(result.specTemplates.length).toBeGreaterThan(0)

    // Files should exist
    expect(existsSync(join(tmpDir, 'kata', 'templates', 'task.md'))).toBe(true)
    expect(existsSync(join(tmpDir, 'kata', 'templates', 'planning.md'))).toBe(true)
    expect(existsSync(join(tmpDir, 'kata', 'spec-templates', 'feature.md'))).toBe(true)
  })

  it('skips existing files without --update', () => {
    const tmpDir = makeTmpDir('user-skip')
    tmpDirs.push(tmpDir)
    process.env.XDG_CONFIG_HOME = tmpDir

    // First run creates files
    scaffoldUserBatteries()

    // Second run should skip
    const result = scaffoldUserBatteries()
    expect(result.templates.length).toBe(0)
    expect(result.specTemplates.length).toBe(0)
    expect(result.skipped.length).toBeGreaterThan(0)
  })

  it('overwrites existing files with update=true', () => {
    const tmpDir = makeTmpDir('user-update')
    tmpDirs.push(tmpDir)
    process.env.XDG_CONFIG_HOME = tmpDir

    // First run creates files
    scaffoldUserBatteries()

    // Modify a file
    writeFileSync(join(tmpDir, 'kata', 'templates', 'task.md'), '# modified')

    // Update should overwrite
    const result = scaffoldUserBatteries(true)
    expect(result.updated.length).toBeGreaterThan(0)
  })

  it('does NOT create agents or github templates', () => {
    const tmpDir = makeTmpDir('user-no-agents')
    tmpDirs.push(tmpDir)
    process.env.XDG_CONFIG_HOME = tmpDir

    scaffoldUserBatteries()

    // No agents or github dirs should exist
    expect(existsSync(join(tmpDir, 'kata', 'agents'))).toBe(false)
    expect(existsSync(join(tmpDir, 'kata', '.github'))).toBe(false)
    expect(existsSync(join(tmpDir, 'kata', 'ISSUE_TEMPLATE'))).toBe(false)
  })
})
