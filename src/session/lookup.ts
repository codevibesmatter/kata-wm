// Session ID lookup utilities
import * as path from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * Get the workflow-management package root directory
 * Uses import.meta.url to find the package location
 * @returns Absolute path to packages/workflow-management/
 */
export function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // When bundled by tsup, file is at dist/index.js
  // When running from source (ts-node), file is at src/session/lookup.ts
  // Detect bundled state by checking if we're in 'dist' directory
  if (__dirname.endsWith('/dist') || __dirname.endsWith('\\dist')) {
    return path.resolve(__dirname, '..')
  }
  // From src/session/lookup.ts, go up 2 levels to package root
  return path.resolve(__dirname, '..', '..')
}

/**
 * Find Claude project directory by walking up from cwd
 * Priority:
 * 1. CLAUDE_PROJECT_DIR env var (explicit override)
 * 2. Walk up looking for .claude/sessions/ or .claude/workflows/
 * @returns Absolute path to project root
 * @throws Error if not in a Claude project
 */
export function findClaudeProjectDir(): string {
  // Honor CLAUDE_PROJECT_DIR env var (set by hooks, npm installs, CI)
  const envDir = process.env.CLAUDE_PROJECT_DIR
  if (envDir && existsSync(path.join(envDir, '.claude'))) {
    return envDir
  }

  let dir = process.cwd()
  const root = path.parse(dir).root

  while (dir !== root) {
    // Accept .claude/sessions/ (existing) or .claude/workflows/ (npm installs without sessions)
    if (
      existsSync(path.join(dir, '.claude/sessions')) ||
      existsSync(path.join(dir, '.claude/workflows'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    // Stop at git repo boundary — if this dir has .git, don't walk above it
    // into a different project's .claude/
    if (existsSync(path.join(dir, '.git'))) {
      break
    }
    dir = parent
  }

  throw new Error(
    'Not in a Claude project directory (no .claude/sessions/ or .claude/workflows/ found)\n' +
      'Run: wm doctor --fix\n' +
      'Or set CLAUDE_PROJECT_DIR environment variable',
  )
}

// UUID v4 pattern (Claude Code session IDs)
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Get current Claude Code session ID.
 *
 * Resolution order:
 * 1. --session=ID flag (handled by callers before reaching here)
 * 2. Scan .claude/sessions/ for the most recently modified state.json
 *    (the active session is always the most recently touched one)
 * 3. Throws if no sessions exist
 *
 * @throws Error if no session ID can be determined
 */
export async function getCurrentSessionId(): Promise<string> {
  try {
    const projectDir = findClaudeProjectDir()
    const sessionsDir = path.join(projectDir, '.claude', 'sessions')
    if (!existsSync(sessionsDir)) {
      throw new Error('no sessions dir')
    }
    const entries = readdirSync(sessionsDir, { withFileTypes: true })
    const candidates = entries
      .filter((e) => e.isDirectory() && SESSION_ID_RE.test(e.name))
      .map((e) => {
        const stateFile = path.join(sessionsDir, e.name, 'state.json')
        try {
          const { mtimeMs } = statSync(stateFile)
          return { id: e.name, mtimeMs }
        } catch {
          return null
        }
      })
      .filter((x): x is { id: string; mtimeMs: number } => x !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    if (candidates[0]) {
      return candidates[0].id
    }
  } catch {
    // fall through
  }
  throw new Error(
    'Session ID not available. Pass --session=SESSION_ID explicitly.\n' +
      'Hook handlers receive session_id from stdin JSON and must forward it.',
  )
}

/**
 * Get path to session state.json file
 * @param sessionId - Optional session ID (uses getCurrentSessionId if not provided)
 * @returns Absolute path to state.json
 */
export async function getStateFilePath(sessionId?: string): Promise<string> {
  const sid = sessionId || (await getCurrentSessionId())
  const claudeDir = findClaudeProjectDir()
  return path.join(claudeDir, '.claude/sessions', sid, 'state.json')
}

/**
 * Get the user-level configuration directory for kata.
 * Respects XDG_CONFIG_HOME if set, otherwise uses ~/.config/kata.
 * Always returns the path — does not create the directory.
 * @returns Absolute path to user config directory
 */
export function getUserConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')
  return path.join(xdgConfig, 'kata')
}

/**
 * Paths to modes.yaml configuration files across all three tiers.
 * Resolution order (lowest to highest priority): package → user → project.
 */
export interface ModesYamlPaths {
  packagePath: string
  userPath: string | null
  projectPath: string | null
}

/**
 * Get paths to modes.yaml configuration files across all three tiers.
 * Returns package (always present), user (if exists), and project (if exists).
 * @returns Object with packagePath, userPath, and projectPath
 */
export function getModesYamlPath(): ModesYamlPaths {
  const packagePath = path.join(getPackageRoot(), 'modes.yaml')

  let userPath: string | null = null
  const userCandidate = path.join(getUserConfigDir(), 'modes.yaml')
  if (existsSync(userCandidate)) {
    userPath = userCandidate
  }

  let projectPath: string | null = null
  try {
    const projectRoot = findClaudeProjectDir()
    const candidate = path.join(projectRoot, '.claude', 'workflows', 'modes.yaml')
    if (existsSync(candidate)) {
      projectPath = candidate
    }
  } catch {
    // No Claude project dir found - project-level override not available
  }

  return { packagePath, userPath, projectPath }
}

/**
 * Get path to package templates directory
 * @returns Absolute path to templates/
 */
export function getTemplatesDir(): string {
  return path.join(getPackageRoot(), 'templates')
}

/**
 * Resolve a template path across all three tiers.
 * Lookup order (first match wins): project → user → package batteries.
 *
 * 1. Absolute path — use as-is
 * 2. Project: .claude/workflows/templates/{name}
 * 3. User: ~/.config/kata/templates/{name}
 * 4. Package: batteries/templates/{name}
 *
 * @param templatePath - Template filename or path
 * @returns Absolute path to template
 * @throws Error if template not found at any tier
 */
export function resolveTemplatePath(templatePath: string): string {
  // Absolute path - use as-is
  if (path.isAbsolute(templatePath)) {
    if (existsSync(templatePath)) {
      return templatePath
    }
    throw new Error(`Template not found: ${templatePath}`)
  }

  const checked: string[] = []

  // 1. Project-level template (highest priority)
  try {
    const projectRoot = findClaudeProjectDir()
    const projectTemplate = path.join(projectRoot, '.claude/workflows/templates', templatePath)
    checked.push(projectTemplate)
    if (existsSync(projectTemplate)) {
      return projectTemplate
    }
  } catch {
    // No Claude project dir found — skip project tier
  }

  // 2. User-level template
  const userTemplate = path.join(getUserConfigDir(), 'templates', templatePath)
  checked.push(userTemplate)
  if (existsSync(userTemplate)) {
    return userTemplate
  }

  // 3. Package batteries template (lowest priority, runtime fallback)
  const packageTemplate = path.join(getPackageRoot(), 'batteries', 'templates', templatePath)
  checked.push(packageTemplate)
  if (existsSync(packageTemplate)) {
    return packageTemplate
  }

  throw new Error(
    `Template not found: ${templatePath}\n` +
      `Checked:\n${checked.map((p) => `  - ${p}`).join('\n')}\n` +
      `Run 'kata batteries' to seed project templates, or 'kata batteries --user' for user-level.`,
  )
}

/**
 * Resolve a spec template path across all three tiers.
 * Lookup order (first match wins): project → user → package batteries.
 *
 * 1. Project: planning/spec-templates/{name}
 * 2. User: ~/.config/kata/spec-templates/{name}
 * 3. Package: batteries/spec-templates/{name}
 *
 * @param name - Spec template filename (e.g. "feature.md")
 * @returns Absolute path to spec template
 * @throws Error if spec template not found at any tier
 */
export function resolveSpecTemplatePath(name: string): string {
  const checked: string[] = []

  // 1. Project-level spec template
  try {
    const projectRoot = findClaudeProjectDir()
    const projectTemplate = path.join(projectRoot, 'planning', 'spec-templates', name)
    checked.push(projectTemplate)
    if (existsSync(projectTemplate)) {
      return projectTemplate
    }
  } catch {
    // No Claude project dir found — skip project tier
  }

  // 2. User-level spec template
  const userTemplate = path.join(getUserConfigDir(), 'spec-templates', name)
  checked.push(userTemplate)
  if (existsSync(userTemplate)) {
    return userTemplate
  }

  // 3. Package batteries spec template
  const packageTemplate = path.join(getPackageRoot(), 'batteries', 'spec-templates', name)
  checked.push(packageTemplate)
  if (existsSync(packageTemplate)) {
    return packageTemplate
  }

  throw new Error(
    `Spec template not found: ${name}\n` +
      `Checked:\n${checked.map((p) => `  - ${p}`).join('\n')}\n` +
      `Run 'kata batteries' to seed spec templates, or 'kata batteries --user' for user-level.`,
  )
}
