// wm teardown - Remove wm from a project
// Removes wm hook entries from .claude/settings.json
// Deletes .claude/workflows/wm.yaml
// Preserves .claude/sessions/ and all non-wm hooks
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { findClaudeProjectDir } from '../session/lookup.js'

/**
 * Parse command line arguments for teardown command
 */
function parseArgs(args: string[]): {
  yes: boolean
  all: boolean
  dryRun: boolean
  cwd: string
  explicitCwd: boolean
} {
  let yes = false
  let all = false
  let dryRun = false
  let cwd = process.cwd()
  let explicitCwd = false

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--all') {
      all = true
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length)
      explicitCwd = true
    }
  }

  return { yes, all, dryRun, cwd, explicitCwd }
}

/**
 * Settings.json hook entry structure (same as setup.ts)
 */
interface HookEntry {
  matcher?: string
  hooks: Array<{
    type: string
    command: string
    timeout?: number
  }>
}

interface SettingsJson {
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

/**
 * Remove wm hook entries from settings.json
 * Returns the cleaned settings and list of removed entries
 */
function removeWmHooks(settings: SettingsJson): { cleaned: SettingsJson; removed: string[] } {
  const removed: string[] = []
  const existingHooks = settings.hooks ?? {}
  const cleanedHooks: Record<string, HookEntry[]> = {}

  for (const [event, entries] of Object.entries(existingHooks)) {
    const kept: HookEntry[] = []
    for (const entry of entries) {
      // Match on known wm subcommand names to avoid false positives from
      // unrelated tools (lefthook, husky, custom scripts) that also contain 'hook'.
      const wmHookPattern =
        /\bhook (session-start|user-prompt|stop-conditions|mode-gate|task-deps|task-evidence)\b/
      const isWmHook = entry.hooks?.some(
        (h) => typeof h.command === 'string' && wmHookPattern.test(h.command),
      )
      if (isWmHook) {
        const cmd = entry.hooks?.find((h) => wmHookPattern.test(h.command))?.command ?? 'unknown'
        removed.push(`${event}: ${cmd}`)
      } else {
        kept.push(entry)
      }
    }
    if (kept.length > 0) {
      cleanedHooks[event] = kept
    }
  }

  return {
    cleaned: {
      ...settings,
      hooks: Object.keys(cleanedHooks).length > 0 ? cleanedHooks : undefined,
    },
    removed,
  }
}

/**
 * wm teardown [--yes] [--all] [--dry-run] [--cwd=PATH]
 *
 * Remove wm from a project:
 * - Removes wm hook entries from .claude/settings.json (identified by 'wm hook' command substring)
 * - Deletes .claude/workflows/wm.yaml
 * - Preserves .claude/sessions/ and all non-wm hooks
 * - --yes: Skip confirmation
 * - --all: Also remove .claude/workflows/modes.yaml
 * - --dry-run: Show what would be removed without making changes
 *
 * Idempotent: safe to run multiple times.
 */
export async function teardown(args: string[]): Promise<void> {
  const parsed = parseArgs(args)
  const actions: string[] = []

  // Resolve to actual project root.
  // Explicit --cwd always wins (user knows the target project).
  // Otherwise walk up to find .claude/ to handle running from a subdirectory.
  let projectRoot = parsed.cwd
  if (!parsed.explicitCwd) {
    try {
      projectRoot = findClaudeProjectDir()
    } catch {
      // No .claude/ found up the tree — use cwd
    }
  }

  // 1. Check for wm hooks in settings.json
  const settingsPath = join(projectRoot, '.claude', 'settings.json')
  let settingsContent: SettingsJson = {}
  let hasSettings = false

  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8')
      settingsContent = JSON.parse(raw) as SettingsJson
      hasSettings = true
    } catch {
      // Invalid settings.json
    }
  }

  const { cleaned, removed } = removeWmHooks(settingsContent)

  if (removed.length > 0) {
    for (const r of removed) {
      actions.push(`Remove hook: ${r}`)
    }
  }

  // 2. Check for wm.yaml
  const wmYamlPath = join(projectRoot, '.claude', 'workflows', 'wm.yaml')
  if (existsSync(wmYamlPath)) {
    actions.push('Delete: .claude/workflows/wm.yaml')
  }

  // 3. Check for modes.yaml (only with --all)
  const modesYamlPath = join(projectRoot, '.claude', 'workflows', 'modes.yaml')
  if (parsed.all && existsSync(modesYamlPath)) {
    actions.push('Delete: .claude/workflows/modes.yaml')
  }

  // No actions needed
  if (actions.length === 0) {
    process.stdout.write('Nothing to teardown. wm is not configured in this project.\n')
    return
  }

  // Show planned actions
  process.stdout.write('wm teardown:\n')
  for (const action of actions) {
    process.stdout.write(`  ${parsed.dryRun ? '[DRY RUN] ' : ''}${action}\n`)
  }

  if (parsed.dryRun) {
    process.stdout.write('\nDry run complete. No changes made.\n')
    return
  }

  // Confirm unless --yes
  if (!parsed.yes) {
    process.stdout.write('\nThis will remove wm hooks and config. Sessions are preserved.\n')
    process.stdout.write('Run with --yes to confirm, or --dry-run to preview.\n')
    process.exitCode = 1
    return
  }

  // Execute teardown
  // 1. Update settings.json (remove wm hooks)
  if (removed.length > 0 && hasSettings) {
    writeFileSync(settingsPath, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf-8')
  }

  // 2. Delete wm.yaml
  if (existsSync(wmYamlPath)) {
    unlinkSync(wmYamlPath)
  }

  // 3. Delete modes.yaml (only with --all)
  if (parsed.all && existsSync(modesYamlPath)) {
    unlinkSync(modesYamlPath)
  }

  process.stdout.write('\nTeardown complete. Sessions preserved at .claude/sessions/\n')
}
