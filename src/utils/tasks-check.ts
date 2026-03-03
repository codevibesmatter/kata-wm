import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Check whether Claude Code native tasks are enabled.
 *
 * The CLAUDE_CODE_ENABLE_TASKS env var (default: "true") controls the task
 * tracking system. When "false", Claude Code reverts to the legacy TODO list
 * and kata's native task files are ignored.
 *
 * Resolution order:
 * 1. process.env.CLAUDE_CODE_ENABLE_TASKS (runtime override)
 * 2. ~/.claude/settings.json env.CLAUDE_CODE_ENABLE_TASKS (user settings)
 * 3. Default: true
 */
export function isNativeTasksEnabled(): boolean {
  // Runtime env takes precedence
  if (process.env.CLAUDE_CODE_ENABLE_TASKS === 'false') return false
  if (process.env.CLAUDE_CODE_ENABLE_TASKS === 'true') return true

  // Fall back to ~/.claude/settings.json
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
      const envBlock = settings.env as Record<string, unknown> | undefined
      if (envBlock?.CLAUDE_CODE_ENABLE_TASKS === 'false') return false
    }
  } catch {
    // Ignore parse errors — assume enabled
  }

  return true
}
