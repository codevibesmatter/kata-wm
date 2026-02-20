import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { cleanupOldSessions } from './session-cleanup.js'

function makeTmpDir(): string {
  const dir = join(
    os.tmpdir(),
    `wm-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('cleanupOldSessions', () => {
  let tmpDir: string
  let claudeDir: string
  let sessionsDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    claudeDir = join(tmpDir, '.claude')
    sessionsDir = join(claudeDir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    // Write sentinel so tests don't trigger first-run dry-run by default
    writeFileSync(join(claudeDir, '.cleanup-ran'), new Date().toISOString())
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeSession(
    id: string,
    ageDays: number,
    opts?: { inProgress?: boolean; keepFile?: boolean; stateData?: Record<string, unknown> },
  ): string {
    const dir = join(sessionsDir, id)
    mkdirSync(dir, { recursive: true })
    if (opts?.inProgress) {
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ status: 'in_progress' }))
    } else if (opts?.stateData) {
      writeFileSync(join(dir, 'state.json'), JSON.stringify(opts.stateData))
    }
    if (opts?.keepFile) {
      writeFileSync(join(dir, '.keep'), '')
    }
    // Set mtime to ageDays ago
    const t = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
    utimesSync(dir, t, t)
    return id
  }

  it('deletes expired sessions', () => {
    makeSession('old-session', 10)
    const result = cleanupOldSessions(claudeDir, 7, 'current-session')
    expect(result.deleted).toContain('old-session')
    expect(existsSync(join(sessionsDir, 'old-session'))).toBe(false)
  })

  it('keeps recent sessions', () => {
    makeSession('new-session', 3)
    const result = cleanupOldSessions(claudeDir, 7, 'current-session')
    expect(result.deleted).not.toContain('new-session')
    expect(result.skipped).toContain('new-session')
    expect(existsSync(join(sessionsDir, 'new-session'))).toBe(true)
  })

  it('skips in_progress sessions', () => {
    makeSession('active-session', 30, { inProgress: true })
    const result = cleanupOldSessions(claudeDir, 7, 'current-session')
    expect(result.deleted).not.toContain('active-session')
    expect(result.skipped).toContain('active-session')
    expect(existsSync(join(sessionsDir, 'active-session'))).toBe(true)
  })

  it('skips sessions with .keep file', () => {
    makeSession('pinned-session', 30, { keepFile: true })
    const result = cleanupOldSessions(claudeDir, 7, 'current-session')
    expect(result.deleted).not.toContain('pinned-session')
    expect(result.skipped).toContain('pinned-session')
    expect(existsSync(join(sessionsDir, 'pinned-session'))).toBe(true)
  })

  it('skips the current session', () => {
    makeSession('current-session', 30)
    const result = cleanupOldSessions(claudeDir, 7, 'current-session')
    expect(result.deleted).not.toContain('current-session')
    expect(result.skipped).toContain('current-session')
    expect(existsSync(join(sessionsDir, 'current-session'))).toBe(true)
  })

  it('performs dry-run on first run and writes sentinel', () => {
    // Remove sentinel to simulate first run
    rmSync(join(claudeDir, '.cleanup-ran'))
    makeSession('old-session', 30)
    const result = cleanupOldSessions(claudeDir, 7, 'current')
    // Dry-run: reported in deleted but not actually deleted
    expect(result.deleted).toContain('old-session')
    expect(existsSync(join(sessionsDir, 'old-session'))).toBe(true)
    // Sentinel written after first run
    expect(existsSync(join(claudeDir, '.cleanup-ran'))).toBe(true)
  })

  it('does not write sentinel when opts.dryRun is true on first run', () => {
    // Remove sentinel to simulate first run
    rmSync(join(claudeDir, '.cleanup-ran'))
    makeSession('old-session', 30)
    const result = cleanupOldSessions(claudeDir, 7, 'current', { dryRun: true })
    expect(result.deleted).toContain('old-session')
    expect(existsSync(join(sessionsDir, 'old-session'))).toBe(true)
    // Sentinel should NOT be written when opts.dryRun is true
    expect(existsSync(join(claudeDir, '.cleanup-ran'))).toBe(false)
  })

  it('actually deletes on second run after first-run dry-run', () => {
    // Remove sentinel -> first run is dry-run
    rmSync(join(claudeDir, '.cleanup-ran'))
    makeSession('old-session', 30)

    // First run: dry-run only, sentinel written
    cleanupOldSessions(claudeDir, 7, 'current')
    expect(existsSync(join(sessionsDir, 'old-session'))).toBe(true)
    expect(existsSync(join(claudeDir, '.cleanup-ran'))).toBe(true)

    // Second run: sentinel exists, actually deletes
    const result = cleanupOldSessions(claudeDir, 7, 'current')
    expect(result.deleted).toContain('old-session')
    expect(existsSync(join(sessionsDir, 'old-session'))).toBe(false)
  })

  it('logs to stderr when opts.verbose is true', () => {
    makeSession('old-session', 30)
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }
    try {
      cleanupOldSessions(claudeDir, 7, 'current', { verbose: true })
    } finally {
      process.stderr.write = origWrite
    }
    const output = stderrChunks.join('')
    expect(output).toContain('wm cleanup:')
    expect(output).toContain('old-session')
  })

  it('logs dry-run prefix when verbose and dry-run', () => {
    makeSession('old-session', 30)
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }
    try {
      cleanupOldSessions(claudeDir, 7, 'current', { verbose: true, dryRun: true })
    } finally {
      process.stderr.write = origWrite
    }
    const output = stderrChunks.join('')
    expect(output).toContain('[dry-run]')
    expect(output).toContain('old-session')
  })

  it('returns empty arrays when sessions directory does not exist', () => {
    rmSync(sessionsDir, { recursive: true })
    const result = cleanupOldSessions(claudeDir, 7, 'current')
    expect(result.deleted).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('handles multiple sessions with mixed states', () => {
    makeSession('expired', 30)
    makeSession('recent', 2)
    makeSession('in-progress', 30, { inProgress: true })
    makeSession('kept', 30, { keepFile: true })
    makeSession('my-session', 30)

    const result = cleanupOldSessions(claudeDir, 7, 'my-session')

    expect(result.deleted).toContain('expired')
    expect(result.skipped).toContain('recent')
    expect(result.skipped).toContain('in-progress')
    expect(result.skipped).toContain('kept')
    expect(result.skipped).toContain('my-session')
    expect(existsSync(join(sessionsDir, 'expired'))).toBe(false)
    expect(existsSync(join(sessionsDir, 'recent'))).toBe(true)
    expect(existsSync(join(sessionsDir, 'in-progress'))).toBe(true)
    expect(existsSync(join(sessionsDir, 'kept'))).toBe(true)
    expect(existsSync(join(sessionsDir, 'my-session'))).toBe(true)
  })

  it('skips sessions with unparseable state.json', () => {
    const id = makeSession('bad-state', 30)
    writeFileSync(join(sessionsDir, id, 'state.json'), 'not-json{{{')
    const result = cleanupOldSessions(claudeDir, 7, 'current')
    expect(result.skipped).toContain('bad-state')
    expect(result.deleted).not.toContain('bad-state')
  })

  it('deletes sessions with state.json that has non-in_progress status', () => {
    makeSession('completed', 30, { stateData: { status: 'completed' } })
    const result = cleanupOldSessions(claudeDir, 7, 'current')
    expect(result.deleted).toContain('completed')
    expect(existsSync(join(sessionsDir, 'completed'))).toBe(false)
  })
})
