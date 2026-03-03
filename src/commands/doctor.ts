// kata doctor - Diagnose and fix session state issues
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { findProjectDir, getPackageRoot, getSessionsDir } from '../session/lookup.js'
import { resolveWmBin } from './setup.js'
import { isNativeTasksEnabled } from '../utils/tasks-check.js'

interface DiagnosticResult {
  check: string
  status: 'ok' | 'warning' | 'error'
  message: string
  fixable: boolean
}

interface DoctorOutput {
  success: boolean
  diagnostics: DiagnosticResult[]
  fixed?: string[]
  sessionId?: string
}

function parseArgs(args: string[]): { fix: boolean; json: boolean } {
  return {
    fix: args.includes('--fix'),
    json: args.includes('--json'),
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Get Claude project dir, falling back to cwd for bootstrap scenarios
 * (when .claude/sessions/ or .claude/workflows/ may not exist yet)
 */
function getProjectDir(useFallback: boolean): string {
  if (useFallback) {
    try {
      return findProjectDir()
    } catch {
      return process.cwd()
    }
  }
  return findProjectDir()
}

/**
 * Check if kata hooks are registered in .claude/settings.json
 */
function checkHooksRegistered(claudeDir: string): {
  registered: string[]
  missing: string[]
} {
  const settingsPath = path.join(claudeDir, '.claude', 'settings.json')
  // Match on the hook subcommand (not the binary name) to tolerate both bare
  // `kata hook …` and quoted `"/path/to/kata" hook …` forms written by setup.
  const requiredHooks: Record<string, string> = {
    SessionStart: 'hook session-start',
    UserPromptSubmit: 'hook user-prompt',
    Stop: 'hook stop-conditions',
  }

  const registered: string[] = []
  const missing: string[] = []

  if (!existsSync(settingsPath)) {
    return { registered: [], missing: Object.keys(requiredHooks) }
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
    }
    const hooks = settings.hooks ?? {}

    for (const [event, expectedCmd] of Object.entries(requiredHooks)) {
      const entries = hooks[event] ?? []
      const found = entries.some((entry) =>
        entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(expectedCmd)),
      )
      if (found) {
        registered.push(event)
      } else {
        missing.push(event)
      }
    }
  } catch {
    return { registered: [], missing: Object.keys(requiredHooks) }
  }

  return { registered, missing }
}

/**
 * Auto-register missing hooks in .claude/settings.json
 */
function fixMissingHooks(claudeDir: string, missingHooks: string[]): void {
  const settingsPath = path.join(claudeDir, '.claude', 'settings.json')

  // Read existing or create new
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8')
      settings = JSON.parse(raw) as Record<string, unknown>
    } catch {
      settings = {}
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>

  // Use absolute path to kata binary (same as setup.ts) so hooks work regardless of PATH
  const wmBin = `"${resolveWmBin()}"`
  const hookCommands: Record<string, { command: string; timeout?: number }> = {
    SessionStart: { command: `${wmBin} hook session-start` },
    UserPromptSubmit: { command: `${wmBin} hook user-prompt` },
    Stop: { command: `${wmBin} hook stop-conditions`, timeout: 30 },
  }

  for (const event of missingHooks) {
    const cmd = hookCommands[event]
    if (!cmd) continue

    if (!hooks[event]) {
      hooks[event] = []
    }

    const entry: Record<string, unknown> = {
      hooks: [
        {
          type: 'command',
          command: cmd.command,
          ...(cmd.timeout ? { timeout: cmd.timeout } : {}),
        },
      ],
    }
    ;(hooks[event] as unknown[]).push(entry)
  }

  settings.hooks = hooks

  // Ensure .claude directory exists
  const claudeConfigDir = path.join(claudeDir, '.claude')
  if (!existsSync(claudeConfigDir)) {
    mkdirSync(claudeConfigDir, { recursive: true })
  }

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}

/**
 * Get running kata version from package.json
 */
function getRunningVersion(): string {
  try {
    const pkgPath = path.join(getPackageRoot(), 'package.json')
    if (existsSync(pkgPath)) {
      const raw = readFileSync(pkgPath, 'utf-8')
      const parsed = JSON.parse(raw) as { version?: string }
      if (parsed.version) {
        return parsed.version
      }
    }
  } catch {
    // Fall through
  }
  return '0.0.0'
}

export async function doctor(args: string[]): Promise<void> {
  const parsed = parseArgs(args)
  const diagnostics: DiagnosticResult[] = []
  const fixed: string[] = []

  // Use cwd fallback for bootstrap scenarios (--fix may need to create .claude/)
  const claudeDir = getProjectDir(parsed.fix)
  const sessionsDir = getSessionsDir(claudeDir)
  const currentSessionPath = path.join(claudeDir, '.claude/current-session-id')

  // Check 1: Sessions directory
  if (!(await fileExists(sessionsDir))) {
    diagnostics.push({
      check: 'sessions_dir',
      status: 'error',
      message: 'Sessions directory missing',
      fixable: true,
    })
    if (parsed.fix) {
      await fs.mkdir(sessionsDir, { recursive: true })
      fixed.push('Created sessions directory')
    }
  } else {
    diagnostics.push({
      check: 'sessions_dir',
      status: 'ok',
      message: 'Sessions directory exists',
      fixable: false,
    })
  }

  // Check 2: current-session-id file (LEGACY - informational only)
  // This file is deprecated. Modern lookup uses CLAUDE_SESSION_ID env var -> registry.jsonl
  if (await fileExists(currentSessionPath)) {
    const currentId = (await fs.readFile(currentSessionPath, 'utf-8')).trim()
    diagnostics.push({
      check: 'current_session_id',
      status: 'ok',
      message: `Legacy file exists: ${currentId} (deprecated, prefer CLAUDE_SESSION_ID env var)`,
      fixable: false,
    })
  } else {
    diagnostics.push({
      check: 'current_session_id',
      status: 'ok',
      message: 'Legacy file not present (correct - use CLAUDE_SESSION_ID env var)',
      fixable: false,
    })
  }


  // Check 6: Hooks registered in .claude/settings.json
  const hookCheck = checkHooksRegistered(claudeDir)
  if (hookCheck.missing.length > 0) {
    diagnostics.push({
      check: 'hooks_registered',
      status: 'warning',
      message: `Missing kata hooks in settings.json: ${hookCheck.missing.join(', ')}`,
      fixable: true,
    })
    if (parsed.fix) {
      fixMissingHooks(claudeDir, hookCheck.missing)
      fixed.push(`Registered missing hooks: ${hookCheck.missing.join(', ')}`)
    }
  } else {
    diagnostics.push({
      check: 'hooks_registered',
      status: 'ok',
      message: `All required hooks registered: ${hookCheck.registered.join(', ')}`,
      fixable: false,
    })
  }

  // Check: Native tasks enabled
  if (!isNativeTasksEnabled()) {
    diagnostics.push({
      check: 'native_tasks',
      status: 'warning',
      message:
        'CLAUDE_CODE_ENABLE_TASKS is disabled — kata workflow tracking will not work. ' +
        'Set env.CLAUDE_CODE_ENABLE_TASKS to "true" in ~/.claude/settings.json, then restart Claude Code.',
      fixable: true,
    })
    if (parsed.fix) {
      // Write the flag into ~/.claude/settings.json
      const { homedir } = await import('node:os')
      const userSettingsPath = path.join(homedir(), '.claude', 'settings.json')
      let userSettings: Record<string, unknown> = {}
      if (existsSync(userSettingsPath)) {
        try {
          userSettings = JSON.parse(readFileSync(userSettingsPath, 'utf-8')) as Record<
            string,
            unknown
          >
        } catch {
          userSettings = {}
        }
      }
      const envBlock = (userSettings.env ?? {}) as Record<string, unknown>
      envBlock.CLAUDE_CODE_ENABLE_TASKS = 'true'
      userSettings.env = envBlock
      writeFileSync(userSettingsPath, `${JSON.stringify(userSettings, null, 2)}\n`, 'utf-8')
      fixed.push('Set CLAUDE_CODE_ENABLE_TASKS=true in ~/.claude/settings.json — restart Claude Code to activate')
    }
  } else {
    diagnostics.push({
      check: 'native_tasks',
      status: 'ok',
      message: 'Native tasks enabled (CLAUDE_CODE_ENABLE_TASKS)',
      fixable: false,
    })
  }

  // Check 7: Session cleanup (informational)
  try {
    const sessionDirs = await fs.readdir(sessionsDir)
    const sessionCount = sessionDirs.length
    diagnostics.push({
      check: 'session_cleanup',
      status: 'ok',
      message: `${sessionCount} session(s) in directory`,
      fixable: false,
    })
  } catch {
    diagnostics.push({
      check: 'session_cleanup',
      status: 'ok',
      message: 'No sessions to clean up',
      fixable: false,
    })
  }

  // Check 8: Version info
  diagnostics.push({
    check: 'version',
    status: 'ok',
    message: `Version: ${getRunningVersion()}`,
    fixable: false,
  })

  const errors = diagnostics.filter((d) => d.status === 'error').length
  const warnings = diagnostics.filter((d) => d.status === 'warning').length
  const success = errors === 0

  const output: DoctorOutput = {
    success,
    diagnostics,
    ...(fixed.length > 0 && { fixed }),
  }

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } else {
    process.stdout.write('\n=== Session Doctor ===\n\n')
    for (const d of diagnostics) {
      const icon = d.status === 'ok' ? '\u2713' : d.status === 'warning' ? '\u26A0' : '\u2717'
      process.stdout.write(`${icon} ${d.check}: ${d.message}\n`)
    }
    if (fixed.length > 0) {
      process.stdout.write('\nFixed:\n')
      for (const f of fixed) {
        process.stdout.write(`  - ${f}\n`)
      }
    }
    process.stdout.write('\n')
    if (errors > 0 && !parsed.fix) {
      process.stdout.write(`Found ${errors} error(s). Run with --fix to repair.\n`)
    } else if (warnings > 0 && !parsed.fix) {
      process.stdout.write(`Found ${warnings} warning(s). Run with --fix to repair.\n`)
    } else if (success) {
      process.stdout.write('All checks passed.\n')
    }
  }

  if (!success && !parsed.fix) process.exit(1)
}
