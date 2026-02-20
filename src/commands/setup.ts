// wm setup - Initialize wm in a project
// When --yes is passed, skip interview and use auto-detected defaults.
// When --yes is absent, enter setup mode with 6-phase interview template.
// Hook registration uses 'wm hook <name>' commands in .claude/settings.json.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jsYaml from 'js-yaml'
import { getDefaultProfile, type SetupProfile } from '../config/setup-profile.js'
import type { WmConfig } from '../config/wm-config.js'
import { getPackageRoot, findClaudeProjectDir } from '../session/lookup.js'

/**
 * Resolve the absolute path to the wm binary.
 *
 * Prefers `which wm` so hooks point to the bin symlink that npm/pnpm update on
 * upgrade (e.g. /usr/local/bin/wm). Falls back to the package-relative path for
 * workspace / pnpm-link scenarios where `wm` is not yet in PATH.
 */
function resolveWmBin(): string {
  try {
    const which = execSync('which wm 2>/dev/null || command -v wm 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (which) return which
  } catch {
    // which failed or wm not in PATH — fall back to package-relative path
  }
  return join(getPackageRoot(), 'wm')
}

/**
 * Parse command line arguments for setup command
 */
function parseArgs(args: string[]): {
  yes: boolean
  strict: boolean
  cwd: string
  explicitCwd: boolean
} {
  let yes = false
  let strict = false
  let cwd = process.cwd()
  let explicitCwd = false

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--strict') {
      strict = true
    } else if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length)
      explicitCwd = true
    }
  }

  return { yes, strict, cwd, explicitCwd }
}

/**
 * Settings.json hook entry structure
 */
interface HookEntry {
  matcher?: string
  hooks: Array<{
    type: string
    command: string
    timeout?: number
  }>
}

/**
 * Settings.json structure
 */
interface SettingsJson {
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

/**
 * Build wm hook entries for .claude/settings.json.
 * Uses an absolute path to the wm binary so hooks work regardless of PATH
 * (both for globally-installed and locally-installed packages).
 * Default: SessionStart, UserPromptSubmit, Stop
 * With --strict: also PreToolUse gate hooks
 */
function buildHookEntries(strict: boolean, wmBin: string): Record<string, HookEntry[]> {
  // Quote the binary path so spaces in the path are handled correctly
  const bin = `"${wmBin}"`
  const hooks: Record<string, HookEntry[]> = {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: `${bin} hook session-start`,
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: `${bin} hook user-prompt`,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: `${bin} hook stop-conditions`,
            timeout: 30,
          },
        ],
      },
    ],
  }

  if (strict) {
    hooks.PreToolUse = [
      {
        hooks: [
          {
            type: 'command',
            command: `${bin} hook mode-gate`,
            timeout: 10,
          },
        ],
      },
      {
        matcher: 'TaskUpdate',
        hooks: [
          {
            type: 'command',
            command: `${bin} hook task-deps`,
            timeout: 10,
          },
        ],
      },
      {
        matcher: 'TaskUpdate',
        hooks: [
          {
            type: 'command',
            command: `${bin} hook task-evidence`,
            timeout: 10,
          },
        ],
      },
    ]
  }

  return hooks
}

/**
 * Read existing .claude/settings.json or return empty structure
 * Uses cwd-based path since .claude/sessions/ may not exist yet
 */
function readSettings(cwd: string): SettingsJson {
  const settingsPath = join(cwd, '.claude', 'settings.json')
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8')
      return JSON.parse(raw) as SettingsJson
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Write .claude/settings.json
 */
function writeSettings(cwd: string, settings: SettingsJson): void {
  const claudeDir = join(cwd, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  const settingsPath = join(claudeDir, 'settings.json')
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}

/**
 * Merge wm hook entries into existing settings
 * Preserves non-wm hooks, replaces wm hooks
 */
function mergeHooksIntoSettings(
  settings: SettingsJson,
  wmHooks: Record<string, HookEntry[]>,
): SettingsJson {
  const existingHooks = settings.hooks ?? {}
  const merged: Record<string, HookEntry[]> = {}

  // For each hook event, keep non-wm entries and add wm entries
  const allEvents = new Set([...Object.keys(existingHooks), ...Object.keys(wmHooks)])

  for (const event of allEvents) {
    const existing = existingHooks[event] ?? []
    const wmEntries = wmHooks[event] ?? []

    // Filter out existing wm hook entries by matching known wm subcommand names.
    // Tolerates both bare `wm hook …` and quoted `"/path/wm" hook …` forms while
    // avoiding false positives from unrelated tools like lefthook or husky.
    const wmHookPattern =
      /\bhook (session-start|user-prompt|stop-conditions|mode-gate|task-deps|task-evidence)\b/
    const nonWmEntries = existing.filter((entry) => {
      return !entry.hooks?.some(
        (h) => typeof h.command === 'string' && wmHookPattern.test(h.command),
      )
    })

    // Combine: non-wm first, then wm entries
    merged[event] = [...nonWmEntries, ...wmEntries]
  }

  return {
    ...settings,
    hooks: merged,
  }
}

/**
 * Generate wm.yaml content from a WmConfig object
 */
function generateWmYaml(config: WmConfig): string {
  return jsYaml.dump(config, { lineWidth: 120, noRefs: true })
}

/**
 * Build WmConfig from setup profile, merged with any existing wm.yaml.
 * Existing values win for all fields except wm_version (always updated to current).
 * This prevents re-running setup from silently erasing verify_command,
 * prime_extensions, mode_config, or other custom configuration.
 */
function buildWmConfig(projectRoot: string, profile: SetupProfile): WmConfig {
  // Only carry code_review when explicitly enabled (true).
  // False represents "unset" in the profile (same as wm-config.ts getDefaultConfig),
  // meaning "enabled when a reviewer is configured". Writing false would silently
  // disable verification for existing configs that rely on the implicit default.
  const profileReviews: WmConfig['reviews'] = {
    spec_review: profile.reviews.spec_review,
    code_reviewer: profile.reviews.code_reviewer,
    ...(profile.reviews.code_review ? { code_review: true } : {}),
  }

  const fromProfile: WmConfig = {
    project: {
      name: profile.project_name,
      test_command: profile.test_command ?? undefined,
      ci: profile.ci,
    },
    spec_path: profile.spec_path,
    research_path: profile.research_path,
    session_retention_days: profile.session_retention_days,
    reviews: profileReviews,
    wm_version: getWmVersion(),
  }

  const wmYamlPath = join(projectRoot, '.claude', 'workflows', 'wm.yaml')
  if (!existsSync(wmYamlPath)) return fromProfile

  try {
    const raw = readFileSync(wmYamlPath, 'utf-8')
    const existing = jsYaml.load(raw) as WmConfig | null
    if (!existing || typeof existing !== 'object') {
      // Malformed YAML — warn and fall back to profile rather than silently overwriting
      process.stderr.write(
        `wm setup: warning: existing wm.yaml is malformed; using auto-detected defaults\n`,
      )
      return fromProfile
    }

    // Existing config wins for all fields; always bump wm_version
    return {
      ...fromProfile,
      ...existing,
      project: { ...fromProfile.project, ...existing.project },
      reviews: { ...fromProfile.reviews, ...existing.reviews },
      wm_version: getWmVersion(),
    }
  } catch {
    // Parse error — warn and fall back to profile
    process.stderr.write(
      `wm setup: warning: could not parse existing wm.yaml; using auto-detected defaults\n`,
    )
    return fromProfile
  }
}

/**
 * Read wm version from package.json
 */
function getWmVersion(): string {
  try {
    const pkgPath = join(getPackageRoot(), 'package.json')
    if (existsSync(pkgPath)) {
      const raw = readFileSync(pkgPath, 'utf-8')
      const parsed = JSON.parse(raw) as { version?: string }
      if (parsed.version) return parsed.version
    }
  } catch {
    // Fall through
  }
  return '0.0.0'
}

/**
 * Write wm.yaml to .claude/workflows/
 */
function writeWmYaml(cwd: string, content: string): void {
  const workflowsDir = join(cwd, '.claude', 'workflows')
  mkdirSync(workflowsDir, { recursive: true })
  const wmYamlPath = join(workflowsDir, 'wm.yaml')
  writeFileSync(wmYamlPath, content, 'utf-8')
}

/**
 * Resolve the project root for setup.
 * - Explicit --cwd always wins (user knows where they want to set up)
 * - Otherwise: walk up to find existing .claude/ directory (prevents nested .claude/)
 * - Fresh projects with no .claude/ yet: fall back to cwd
 */
function resolveProjectRoot(cwd: string, explicitCwd: boolean): string {
  if (explicitCwd) return cwd
  try {
    return findClaudeProjectDir()
  } catch {
    // Fresh project: no .claude/ yet, use provided cwd
    return cwd
  }
}

/**
 * Write config files and register hooks (full setup — used by --yes path).
 * Merges with existing wm.yaml so re-running does not lose custom config.
 */
function applySetup(cwd: string, profile: SetupProfile, explicitCwd: boolean): void {
  const projectRoot = resolveProjectRoot(cwd, explicitCwd)

  // Build merged config (existing wm.yaml fields win over auto-detected defaults)
  const config = buildWmConfig(projectRoot, profile)
  writeWmYaml(projectRoot, generateWmYaml(config))

  // Ensure sessions directory exists
  mkdirSync(join(projectRoot, '.claude', 'sessions'), { recursive: true })

  // Register hooks in settings.json using absolute wm binary path
  const wmBin = resolveWmBin()
  const settings = readSettings(projectRoot)
  const wmHooks = buildHookEntries(profile.strict, wmBin)
  writeSettings(projectRoot, mergeHooksIntoSettings(settings, wmHooks))
}

/**
 * Initialize directory structure and register hooks for the interactive path.
 * Does NOT write wm.yaml — the setup interview collects answers and writes it.
 * This prevents auto-detected defaults from being the final config when users
 * complete the interview with different answers.
 */
function applySetupHooksOnly(cwd: string, strict: boolean, explicitCwd: boolean): void {
  const projectRoot = resolveProjectRoot(cwd, explicitCwd)

  // Create directory structure so enter() can locate the project
  mkdirSync(join(projectRoot, '.claude', 'sessions'), { recursive: true })
  mkdirSync(join(projectRoot, '.claude', 'workflows'), { recursive: true })

  // Register hooks immediately so they are active during the interview
  const wmBin = resolveWmBin()
  const settings = readSettings(projectRoot)
  const wmHooks = buildHookEntries(strict, wmBin)
  writeSettings(projectRoot, mergeHooksIntoSettings(settings, wmHooks))
}

/**
 * wm setup [--yes] [--strict] [--cwd=PATH]
 *
 * Initialize wm in a project:
 * - --yes: Skip interview, use auto-detected defaults
 * - --strict: Also install PreToolUse gate hooks
 * - Without --yes: Write defaults then enter setup mode (interview template)
 *
 * Installs hooks in PROJECT-LEVEL .claude/settings.json only.
 * Bypasses findClaudeProjectDir() since .claude/ may not exist yet.
 */
export async function setup(args: string[]): Promise<void> {
  const parsed = parseArgs(args)
  // Resolve project root before auto-detecting profile so that running from a
  // subdirectory (e.g. apps/gateway/) doesn't stamp the wrong name/test command
  // into wm.yaml when .claude/ already exists at a higher level.
  const projectRoot = resolveProjectRoot(parsed.cwd, parsed.explicitCwd)
  const profile = getDefaultProfile(projectRoot)
  profile.strict = parsed.strict

  if (parsed.yes) {
    // --yes: write everything with auto-detected defaults and return
    applySetup(parsed.cwd, profile, parsed.explicitCwd)
    // Output summary
    process.stdout.write('wm setup complete:\n')
    process.stdout.write(`  Project: ${profile.project_name}\n`)
    process.stdout.write(`  Test command: ${profile.test_command ?? 'none detected'}\n`)
    process.stdout.write(`  CI: ${profile.ci ?? 'none detected'}\n`)
    process.stdout.write(`  Config: .claude/workflows/wm.yaml\n`)
    process.stdout.write(`  Hooks: .claude/settings.json\n`)
    process.stdout.write(`    - SessionStart\n`)
    process.stdout.write(`    - UserPromptSubmit\n`)
    process.stdout.write(`    - Stop\n`)
    if (parsed.strict) {
      process.stdout.write(`    - PreToolUse (mode-gate)\n`)
      process.stdout.write(`    - PreToolUse (task-deps)\n`)
      process.stdout.write(`    - PreToolUse (task-evidence)\n`)
    }
    process.stdout.write('\nRun: wm doctor to verify setup\n')
    return
  }

  // Interactive path: create directory structure and register hooks, then enter interview.
  // wm.yaml is NOT written here — the interview's write-config phase collects answers
  // and writes the final config. This avoids locking in auto-detected defaults before
  // the user has a chance to confirm or override them.
  applySetupHooksOnly(parsed.cwd, parsed.strict, parsed.explicitCwd)
  process.stdout.write('wm setup: hooks registered. Entering setup interview...\n')
  const { enter } = await import('./enter.js')
  await enter(['setup'])
}
