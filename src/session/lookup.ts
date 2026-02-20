// Session ID lookup utilities
// Port of lib-session.sh logic to TypeScript
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * Get most recent session ID from registry.jsonl
 * @param registryPath - Absolute path to registry.jsonl
 * @returns Session ID or null if not found
 */
async function getLastSessionFromRegistry(registryPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(registryPath, 'utf-8')
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)

    // Walk backwards to find most recent session_started event
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry.event === 'session_started' && entry.sessionId) {
          return entry.sessionId
        }
      } catch {
        // Skip malformed lines (continue is implicit)
      }
    }

    return null
  } catch {
    // Registry not found or not readable
    return null
  }
}

/**
 * Get current Claude Code session ID
 * Methods (in priority order):
 * 1. CLAUDE_SESSION_ID env var
 * 2. Registry (most recent session_started event)
 *
 * @returns Session ID string
 * @throws Error if no active session found
 */
export async function getCurrentSessionId(): Promise<string> {
  // Method 1: CLAUDE_SESSION_ID env var (highest priority, for SDK agents)
  const envSessionId = process.env.CLAUDE_SESSION_ID?.replace(/\n/g, '')
  if (envSessionId && UUID_REGEX.test(envSessionId)) {
    return envSessionId
  }

  // Method 2: Registry - most recent session_started
  const claudeDir = findClaudeProjectDir()
  const registryPath = path.join(claudeDir, '.claude/sessions/registry.jsonl')

  const lastSession = await getLastSessionFromRegistry(registryPath)
  if (lastSession && UUID_REGEX.test(lastSession)) {
    return lastSession
  }

  throw new Error(
    'No active session found. Set CLAUDE_SESSION_ID or ensure registry exists with session_started event.\n' +
      'Run: wm doctor --fix',
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
 * 2. Project-level custom template (.claude/workflows/templates/) - if exists
 * 3. Package built-in template (packages/workflow-management/templates/)
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

  // Check project-level custom template first
  try {
    const projectRoot = findClaudeProjectDir()
    const projectTemplate = path.join(projectRoot, '.claude/workflows/templates', templatePath)
    if (existsSync(projectTemplate)) {
      return projectTemplate
    }
  } catch {
    // No project found, fall through to package templates
  }

  // Package built-in template
  const packageTemplate = path.join(getTemplatesDir(), templatePath)
  if (existsSync(packageTemplate)) {
    return packageTemplate
  }

  throw new Error(
    `Template not found: ${templatePath}\n` +
      `Searched:\n` +
      `  - .claude/workflows/templates/${templatePath}\n` +
      `  - packages/workflow-management/templates/${templatePath}`,
  )
}
