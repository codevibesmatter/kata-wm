import { existsSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CleanupResult {
  deleted: string[]
  skipped: string[]
}

export interface CleanupOpts {
  verbose?: boolean
  dryRun?: boolean
}

/**
 * Clean up old session directories under claudeDir/sessions/
 *
 * Deletes session directories whose mtime exceeds retentionDays,
 * while preserving:
 * - The current session (by sessionId match)
 * - Sessions with state.json status: 'in_progress'
 * - Sessions with a .keep marker file
 *
 * On first run (no .cleanup-ran sentinel), performs dry-run only
 * and writes the sentinel so subsequent runs delete for real.
 *
 * @param claudeDir - Path to .claude/ directory
 * @param retentionDays - Number of days to retain sessions
 * @param currentSessionId - Session ID to always skip
 * @param opts - Options: verbose (log to stderr), dryRun (don't delete)
 * @returns Lists of deleted and skipped session IDs
 */
export function cleanupOldSessions(
  claudeDir: string,
  retentionDays: number,
  currentSessionId: string,
  opts: CleanupOpts = {},
): CleanupResult {
  const sessionsDir = join(claudeDir, 'sessions')
  const sentinelPath = join(claudeDir, '.cleanup-ran')

  if (!existsSync(sessionsDir)) {
    return { deleted: [], skipped: [] }
  }

  // First-run: no sentinel -> dry-run only
  const isFirstRun = !existsSync(sentinelPath)
  const effectiveDryRun = opts.dryRun || isFirstRun

  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000
  const nowMs = Date.now()

  const deleted: string[] = []
  const skipped: string[] = []

  let entries: string[]
  try {
    entries = readdirSync(sessionsDir)
  } catch {
    return { deleted: [], skipped: [] }
  }

  for (const sessionId of entries) {
    const sessionDir = join(sessionsDir, sessionId)

    // Only process directories
    try {
      const stat = statSync(sessionDir)
      if (!stat.isDirectory()) {
        continue
      }
    } catch {
      continue
    }

    // Skip current session
    if (sessionId === currentSessionId) {
      skipped.push(sessionId)
      continue
    }

    // Skip .keep marker
    if (existsSync(join(sessionDir, '.keep'))) {
      skipped.push(sessionId)
      continue
    }

    // Skip in_progress sessions
    const stateFile = join(sessionDir, 'state.json')
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as { status?: string }
        if (state.status === 'in_progress') {
          skipped.push(sessionId)
          continue
        }
      } catch {
        // Can't parse state - skip to be safe
        skipped.push(sessionId)
        continue
      }
    }

    // Check mtime
    try {
      const stat = statSync(sessionDir)
      const ageMs = nowMs - stat.mtimeMs
      if (ageMs < cutoffMs) {
        skipped.push(sessionId)
        continue
      }
    } catch {
      skipped.push(sessionId)
      continue
    }

    // Delete or dry-run
    if (opts.verbose) {
      process.stderr.write(
        `wm cleanup: ${effectiveDryRun ? '[dry-run] ' : ''}deleting session ${sessionId}\n`,
      )
    }

    if (!effectiveDryRun) {
      try {
        rmSync(sessionDir, { recursive: true })
        deleted.push(sessionId)
      } catch {
        skipped.push(sessionId)
      }
    } else {
      // dry-run still reports what would be deleted
      deleted.push(sessionId)
    }
  }

  // Write sentinel on first run (after dry-run completes)
  if (isFirstRun && !opts.dryRun) {
    try {
      writeFileSync(sentinelPath, new Date().toISOString(), 'utf-8')
    } catch {
      // Ignore sentinel write failure
    }
  }

  return { deleted, skipped }
}
