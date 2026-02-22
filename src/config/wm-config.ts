import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir, getUserConfigDir } from '../session/lookup.js'

export interface WmConfig {
  // Project profile
  project?: {
    name?: string
    build_command?: string | null      // compile/build step (null = skip)
    typecheck_command?: string | null  // type check step (null = skip)
    test_command?: string              // run tests
    smoke_command?: string | null      // runtime smoke test (null = skip)
    diff_base?: string                 // git diff baseline branch (default: 'origin/main')
    test_file_pattern?: string         // glob for test files (default: '*.test.ts,*.spec.ts')
    ci?: string | null
  }
  // Path configuration
  spec_path?: string // default: 'planning/specs'
  research_path?: string // default: 'planning/research'
  session_retention_days?: number // default: 7
  hooks_dir?: string // default: '.claude/hooks'
  // Review configuration
  reviews?: {
    spec_review?: boolean
    code_review?: boolean
    code_reviewer?: string | null // 'codex' | 'gemini' | null
  }
  // Mode configuration (project overrides per mode)
  mode_config?: Record<string, unknown>
  // Agent provider configuration
  providers?: {
    default?: string              // default provider name (e.g., 'claude')
    available?: string[]          // detected available providers
    judge_provider?: string       // provider for eval --judge (default: same as default)
    judge_model?: string | null   // override model for judging
  }
  // Extensions
  prime_extensions?: string[]
  // Version tracking
  wm_version?: string
  // Custom verification command (generates .claude/verification-evidence/<issue>.json)
  // e.g. 'playwright test', 'cypress run', or a custom script. Set null to disable.
  verify_command?: string | null
}

export function getDefaultConfig(): Required<
  Pick<WmConfig, 'spec_path' | 'research_path' | 'session_retention_days' | 'hooks_dir'>
> &
  WmConfig {
  return {
    spec_path: 'planning/specs',
    research_path: 'planning/research',
    session_retention_days: 7,
    hooks_dir: '.claude/hooks',
    reviews: {
      spec_review: false,
      // code_review: not set - absence means "enabled when reviewer is configured"
      code_reviewer: null,
    },
  }
}

/**
 * Parse a single wm.yaml file, returning null if missing or invalid.
 */
function parseWmYaml(configPath: string): WmConfig | null {
  if (!existsSync(configPath)) return null
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA }) as WmConfig | null
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Merge a WmConfig overlay onto a base config.
 * Rules (per spec B5):
 * - Scalar fields: later layer wins (null counts as "set")
 * - reviews, providers: shallow merge per key
 * - project: only from project layer (caller controls this)
 * - prime_extensions: later layer replaces entirely
 * - mode_config: shallow merge per mode key
 */
function mergeWmConfig(base: WmConfig, overlay: WmConfig, skipProject = false): WmConfig {
  const merged: WmConfig = { ...base }

  // Scalar overrides
  if (overlay.spec_path !== undefined) merged.spec_path = overlay.spec_path
  if (overlay.research_path !== undefined) merged.research_path = overlay.research_path
  if (overlay.session_retention_days !== undefined)
    merged.session_retention_days = overlay.session_retention_days
  if (overlay.hooks_dir !== undefined) merged.hooks_dir = overlay.hooks_dir
  if (overlay.wm_version !== undefined) merged.wm_version = overlay.wm_version
  if (overlay.verify_command !== undefined) merged.verify_command = overlay.verify_command

  // Arrays: replace entirely
  if (overlay.prime_extensions !== undefined) merged.prime_extensions = overlay.prime_extensions

  // Nested objects: shallow merge
  if (overlay.reviews !== undefined) {
    merged.reviews = { ...merged.reviews, ...overlay.reviews }
  }
  if (overlay.providers !== undefined) {
    merged.providers = { ...merged.providers, ...overlay.providers }
  }
  if (overlay.mode_config !== undefined) {
    merged.mode_config = { ...merged.mode_config, ...overlay.mode_config }
  }

  // project: only from project layer
  if (!skipProject && overlay.project !== undefined) {
    merged.project = overlay.project
  }

  return merged
}

/**
 * Load wm.yaml config with 3-tier merge.
 * Merge order (lowest to highest priority):
 *   hardcoded defaults → user ~/.config/kata/wm.yaml → project .claude/workflows/wm.yaml
 *
 * The user-level `project` key is ignored (project identity is per-project).
 */
export function loadWmConfig(): WmConfig {
  let merged: WmConfig = getDefaultConfig()

  // 1. User-level wm.yaml
  const userConfigPath = join(getUserConfigDir(), 'wm.yaml')
  const userConfig = parseWmYaml(userConfigPath)
  if (userConfig) {
    merged = mergeWmConfig(merged, userConfig, true) // skipProject=true for user layer
  }

  // 2. Project-level wm.yaml (highest priority)
  let projectRoot: string | null = null
  try {
    projectRoot = findClaudeProjectDir()
  } catch {
    // No Claude project dir
  }
  if (projectRoot) {
    const projectConfigPath = join(projectRoot, '.claude', 'workflows', 'wm.yaml')
    const projectConfig = parseWmYaml(projectConfigPath)
    if (projectConfig) {
      merged = mergeWmConfig(merged, projectConfig, false) // skipProject=false for project layer
    }
  }

  return merged
}
