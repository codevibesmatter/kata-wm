// Session ID lookup utilities
import * as path from 'node:path'
import { existsSync } from 'node:fs'
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

/**
 * Get current Claude Code session ID.
 *
 * Session ID comes from hook stdin JSON (input.session_id) — hooks must
 * extract it there and pass it explicitly via --session=ID to subcommands.
 *
 * This function is a last-resort fallback for callers that don't receive
 * session_id from hook input. It always throws — callers must pass --session.
 *
 * @throws Error always — use --session=ID flag instead
 */
export async function getCurrentSessionId(): Promise<string> {
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
 * Package templates are seeds for `wm setup` only.
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
        `Run 'wm setup' to initialize project templates.`,
    )
  } catch (err) {
    if ((err as Error).message.includes('Template not found')) {
      throw err
    }
    // No Claude project dir found
    throw new Error(
      `Template not found: ${templatePath}\n` +
        `Not in a Claude project. Run 'wm setup' to initialize.`,
    )
  }
}
