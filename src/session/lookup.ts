// Session ID lookup utilities
import * as path from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'
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
    dir = path.dirname(dir)
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
 * Paths to modes.yaml configuration files
 * Package-level is the built-in config; project-level is an optional override
 */
export interface ModesYamlPaths {
  packagePath: string
  projectPath: string | null
}

/**
 * Get paths to modes.yaml configuration files
 * Returns both the package-level (built-in) and project-level (override) paths
 * @returns Object with packagePath and projectPath (null if not found)
 */
export function getModesYamlPath(): ModesYamlPaths {
  const packagePath = path.join(getPackageRoot(), 'modes.yaml')

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

  return { packagePath, projectPath }
}

/**
 * Get path to package templates directory
 * @returns Absolute path to templates/
 */
export function getTemplatesDir(): string {
  return path.join(getPackageRoot(), 'templates')
}

/**
 * Resolve a template path
 * Priority:
 * 1. Absolute path - use as-is
 * 2. Project-level template (.claude/workflows/templates/) - required
 *
 * Package templates are seeds for `kata setup` only.
 * After setup, the project owns all templates — no package fallback at runtime.
 * @param templatePath - Template filename or path
 * @returns Absolute path to template
 * @throws Error if template not found
 */
export function resolveTemplatePath(templatePath: string): string {
  // Absolute path - use as-is
  if (path.isAbsolute(templatePath)) {
    if (existsSync(templatePath)) {
      return templatePath
    }
    throw new Error(`Template not found: ${templatePath}`)
  }

  // Project-level template (required — no package fallback)
  try {
    const projectRoot = findClaudeProjectDir()
    const projectTemplate = path.join(projectRoot, '.claude/workflows/templates', templatePath)
    if (existsSync(projectTemplate)) {
      return projectTemplate
    }
    throw new Error(
      `Template not found: ${templatePath}\n` +
        `Expected at: .claude/workflows/templates/${templatePath}\n` +
        `Run 'kata setup' to initialize project templates.`,
    )
  } catch (err) {
    if ((err as Error).message.includes('Template not found')) {
      throw err
    }
    // No Claude project dir found
    throw new Error(
      `Template not found: ${templatePath}\n` +
        `Not in a Claude project. Run 'kata setup' to initialize.`,
    )
  }
}
