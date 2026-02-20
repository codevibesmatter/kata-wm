import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import * as os from 'node:os'
import {
  detectProjectName,
  detectTestCommand,
  detectCI,
  getDefaultProfile,
} from './setup-profile.js'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('detectProjectName', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads name from package.json', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: '@myorg/cool-project', version: '1.0.0' }),
    )
    expect(detectProjectName(tmpDir)).toBe('@myorg/cool-project')
  })

  it('falls back to directory basename when no package.json', () => {
    const name = detectProjectName(tmpDir)
    expect(name).toBe(basename(tmpDir))
  })

  it('falls back to directory basename when package.json has no name', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    const name = detectProjectName(tmpDir)
    expect(name).toBe(basename(tmpDir))
  })

  it('falls back to directory basename for malformed package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not valid json')
    const name = detectProjectName(tmpDir)
    expect(name).toBe(basename(tmpDir))
  })
})

describe('detectTestCommand', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('detects test command from package.json scripts.test', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
    expect(detectTestCommand(tmpDir)).toBe('vitest run')
  })

  it('ignores placeholder test script', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    )
    expect(detectTestCommand(tmpDir)).toBeNull()
  })

  it('detects vitest from config file', () => {
    writeFileSync(join(tmpDir, 'vitest.config.ts'), 'export default {}')
    expect(detectTestCommand(tmpDir)).toBe('vitest')
  })

  it('detects jest from config file', () => {
    writeFileSync(join(tmpDir, 'jest.config.js'), 'module.exports = {}')
    expect(detectTestCommand(tmpDir)).toBe('jest')
  })

  it('detects pytest from config file', () => {
    writeFileSync(join(tmpDir, 'pytest.ini'), '[pytest]')
    expect(detectTestCommand(tmpDir)).toBe('pytest')
  })

  it('returns null when no test config found', () => {
    expect(detectTestCommand(tmpDir)).toBeNull()
  })

  it('prefers package.json scripts.test over config files', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test' } }))
    writeFileSync(join(tmpDir, 'vitest.config.ts'), 'export default {}')
    expect(detectTestCommand(tmpDir)).toBe('bun test')
  })
})

describe('detectCI', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('detects GitHub Actions', () => {
    mkdirSync(join(tmpDir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(tmpDir, '.github', 'workflows', 'ci.yml'), 'name: CI')
    expect(detectCI(tmpDir)).toBe('github-actions')
  })

  it('detects GitLab CI', () => {
    writeFileSync(join(tmpDir, '.gitlab-ci.yml'), 'stages: [test]')
    expect(detectCI(tmpDir)).toBe('gitlab-ci')
  })

  it('detects CircleCI', () => {
    mkdirSync(join(tmpDir, '.circleci'), { recursive: true })
    writeFileSync(join(tmpDir, '.circleci', 'config.yml'), 'version: 2')
    expect(detectCI(tmpDir)).toBe('circleci')
  })

  it('detects Travis CI', () => {
    writeFileSync(join(tmpDir, '.travis.yml'), 'language: node_js')
    expect(detectCI(tmpDir)).toBe('travis-ci')
  })

  it('detects Jenkins', () => {
    writeFileSync(join(tmpDir, 'Jenkinsfile'), 'pipeline { }')
    expect(detectCI(tmpDir)).toBe('jenkins')
  })

  it('returns null when no CI config found', () => {
    expect(detectCI(tmpDir)).toBeNull()
  })

  it('requires .yml/.yaml files in .github/workflows (not just the directory)', () => {
    mkdirSync(join(tmpDir, '.github', 'workflows'), { recursive: true })
    // Empty workflows directory, no yml files
    expect(detectCI(tmpDir)).toBeNull()
  })
})

describe('getDefaultProfile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns correct default values', () => {
    const profile = getDefaultProfile(tmpDir)
    expect(profile.spec_path).toBe('planning/specs')
    expect(profile.research_path).toBe('planning/research')
    expect(profile.session_retention_days).toBe(7)
    expect(profile.reviews.spec_review).toBe(false)
    expect(profile.reviews.code_review).toBe(false)
    expect(profile.reviews.code_reviewer).toBeNull()
    expect(profile.strict).toBe(false)
  })

  it('auto-detects project name from package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'auto-detected-name' }))
    const profile = getDefaultProfile(tmpDir)
    expect(profile.project_name).toBe('auto-detected-name')
  })

  it('auto-detects test command', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'proj', scripts: { test: 'bun test' } }),
    )
    const profile = getDefaultProfile(tmpDir)
    expect(profile.test_command).toBe('bun test')
  })

  it('auto-detects CI system', () => {
    mkdirSync(join(tmpDir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(tmpDir, '.github', 'workflows', 'ci.yml'), 'name: CI')
    const profile = getDefaultProfile(tmpDir)
    expect(profile.ci).toBe('github-actions')
  })

  it('serializes to valid wm.yaml structure', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', scripts: { test: 'vitest' } }),
    )
    const profile = getDefaultProfile(tmpDir)

    // Verify profile has the shape needed for wm.yaml
    expect(profile.project_name).toBe('test-project')
    expect(profile.test_command).toBe('vitest')
    expect(typeof profile.spec_path).toBe('string')
    expect(typeof profile.research_path).toBe('string')
    expect(typeof profile.session_retention_days).toBe('number')
    expect(typeof profile.reviews).toBe('object')
    expect(typeof profile.strict).toBe('boolean')
  })
})
