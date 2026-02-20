// wm doctor - Diagnose and fix session state issues
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { findClaudeProjectDir, getPackageRoot } from '../session/lookup.js'

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

async function getLastSessionFromRegistry(
  registryPath: string,
): Promise<{ sessionId: string; timestamp: string } | null> {
  try {
    const content = await fs.readFile(registryPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry.event === 'session_started' && entry.sessionId) {
          return { sessionId: entry.sessionId, timestamp: entry.timestamp }
        }
      } catch {
        // Skip malformed lines
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get Claude project dir, falling back to cwd for bootstrap scenarios
 * (when .claude/sessions/ or .claude/workflows/ may not exist yet)
 */
function getProjectDir(useFallback: boolean): string {
  if (useFallback) {
    try {
      return findClaudeProjectDir()
    } catch {
      return process.cwd()
    }
  }
  return findClaudeProjectDir()
}

/**
 * Check if wm hooks are registered in .claude/settings.json
 */
function checkHooksRegistered(claudeDir: string): {
  registered: string[]
  missing: string[]
} {
  const settingsPath = path.join(claudeDir, '.claude/settings.json')
  // Match on the hook subcommand (not the binary name) to tolerate both bare
  // `wm hook …` and quoted `"/path/to/wm" hook …` forms written by setup.
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
  const settingsPath = path.join(claudeDir, '.claude/settings.json')

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

  // Use absolute path to wm binary (same as setup.ts) so hooks work regardless of PATH
  const wmBin = `"${path.join(getPackageRoot(), 'wm')}"`
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
 * Check wm version compatibility between running wm and wm.yaml
 */
function checkVersionCompatibility(claudeDir: string): {
  running: string
  configured: string | null
  compatible: boolean
} {
  // Get running version from package.json
  let running = '0.0.0'
  try {
    const pkgPath = path.join(getPackageRoot(), 'package.json')
    if (existsSync(pkgPath)) {
      const raw = readFileSync(pkgPath, 'utf-8')
      const parsed = JSON.parse(raw) as { version?: string }
      if (parsed.version) {
        running = parsed.version
      }
    }
  } catch {
    // Fall through
  }

  // Get configured version from wm.yaml
  let configured: string | null = null
  const wmYamlPath = path.join(claudeDir, '.claude', 'workflows', 'wm.yaml')
  if (existsSync(wmYamlPath)) {
    try {
      const raw = readFileSync(wmYamlPath, 'utf-8')
      const match = raw.match(/wm_version:\s*["']?([^"'\n]+)/)
      if (match) {
        configured = match[1].trim()
      }
    } catch {
      // Fall through
    }
  }

  // Version compatibility check (major version must match)
  let compatible = true
  if (configured) {
    const runningMajor = running.split('.')[0]
    const configuredMajor = configured.split('.')[0]
    if (runningMajor !== configuredMajor) {
      compatible = false
    }
  }

  return { running, configured, compatible }
}

export async function doctor(args: string[]): Promise<void> {
  const parsed = parseArgs(args)
  const diagnostics: DiagnosticResult[] = []
  const fixed: string[] = []

  // Use cwd fallback for bootstrap scenarios (--fix may need to create .claude/)
  const claudeDir = getProjectDir(parsed.fix)
  const sessionsDir = path.join(claudeDir, '.claude/sessions')
  const registryPath = path.join(sessionsDir, 'registry.jsonl')
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

  // Check 2: Registry file
  if (!(await fileExists(registryPath))) {
    diagnostics.push({
      check: 'registry_file',
      status: 'error',
      message: 'Registry file missing',
      fixable: true,
    })
    if (parsed.fix) {
      const newSessionId = randomUUID()
      const entry = {
        event: 'session_started',
        sessionId: newSessionId,
        timestamp: new Date().toISOString(),
      }
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.writeFile(registryPath, `${JSON.stringify(entry)}\n`)
      fixed.push(`Created registry with session ${newSessionId}`)
    }
  } else {
    diagnostics.push({
      check: 'registry_file',
      status: 'ok',
      message: 'Registry file exists',
      fixable: false,
    })
  }

  // Check 3: Registry has session_started
  const lastSession = await getLastSessionFromRegistry(registryPath)
  if (!lastSession) {
    diagnostics.push({
      check: 'registry_session',
      status: 'error',
      message: 'No session_started event',
      fixable: true,
    })
    if (parsed.fix && !fixed.some((f) => f.includes('Created registry'))) {
      const newSessionId = randomUUID()
      const entry = {
        event: 'session_started',
        sessionId: newSessionId,
        timestamp: new Date().toISOString(),
      }
      await fs.appendFile(registryPath, `${JSON.stringify(entry)}\n`)
      fixed.push(`Added session_started for ${newSessionId}`)
    }
  } else {
    diagnostics.push({
      check: 'registry_session',
      status: 'ok',
      message: `Session: ${lastSession.sessionId}`,
      fixable: false,
    })
  }

  // Check 4: current-session-id file (LEGACY - informational only)
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

  // Check 5: State file
  const effectiveSession = lastSession?.sessionId
  if (effectiveSession) {
    const stateFile = path.join(sessionsDir, effectiveSession, 'state.json')
    if (!(await fileExists(stateFile))) {
      diagnostics.push({
        check: 'state_file',
        status: 'warning',
        message: `State missing for ${effectiveSession}`,
        fixable: true,
      })
      if (parsed.fix) {
        await fs.mkdir(path.join(sessionsDir, effectiveSession), { recursive: true })
        const defaultState = {
          sessionId: effectiveSession,
          workflowId: '',
          sessionType: 'default',
          currentMode: 'default',
          completedPhases: [],
          phases: [],
          modeHistory: [],
          modeState: {},
          beadsCreated: [],
          editedFiles: [],
          todosWritten: false,
        }
        await fs.writeFile(stateFile, JSON.stringify(defaultState, null, 2))
        fixed.push(`Created state for ${effectiveSession}`)
      }
    } else {
      diagnostics.push({
        check: 'state_file',
        status: 'ok',
        message: 'State file exists',
        fixable: false,
      })
    }
  }

  // Check 6: Hooks registered in .claude/settings.json
  const hookCheck = checkHooksRegistered(claudeDir)
  if (hookCheck.missing.length > 0) {
    diagnostics.push({
      check: 'hooks_registered',
      status: 'warning',
      message: `Missing wm hooks in settings.json: ${hookCheck.missing.join(', ')}`,
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

  // Check 7: Session cleanup (informational)
  try {
    const sessionDirs = await fs.readdir(sessionsDir)
    const sessionCount = sessionDirs.filter((d) => d !== 'registry.jsonl').length
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

  // Check 8: Version compatibility
  const versionCheck = checkVersionCompatibility(claudeDir)
  if (versionCheck.configured && !versionCheck.compatible) {
    diagnostics.push({
      check: 'version_compatibility',
      status: 'warning',
      message: `Version mismatch: running ${versionCheck.running}, configured ${versionCheck.configured}`,
      fixable: false,
    })
  } else if (versionCheck.configured) {
    diagnostics.push({
      check: 'version_compatibility',
      status: 'ok',
      message: `Version: ${versionCheck.running} (config: ${versionCheck.configured})`,
      fixable: false,
    })
  } else {
    diagnostics.push({
      check: 'version_compatibility',
      status: 'ok',
      message: `Version: ${versionCheck.running} (no wm.yaml configured)`,
      fixable: false,
    })
  }

  const errors = diagnostics.filter((d) => d.status === 'error').length
  const warnings = diagnostics.filter((d) => d.status === 'warning').length
  const success = errors === 0

  const output: DoctorOutput = {
    success,
    diagnostics,
    ...(fixed.length > 0 && { fixed }),
    ...(effectiveSession && { sessionId: effectiveSession }),
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
