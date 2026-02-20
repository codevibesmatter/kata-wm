import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir } from '../session/lookup.js'

export interface WmConfig {
  // Project profile
  project?: {
    name?: string
    test_command?: string
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
  // Extensions
  prime_extensions?: string[]
  // Version tracking
  wm_version?: string
  // Custom verification command (generates .claude/verification-evidence/<issue>.json)
  // Default: 'pnpm at verify work' (Baseplane). Override for other projects or set null to disable.
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
 * Load wm.yaml config from .claude/workflows/wm.yaml
 * Resolves from project root (findClaudeProjectDir) for reliability across subdirectories
 * Falls back to defaults for any missing fields
 */
export function loadWmConfig(): WmConfig {
  const defaults = getDefaultConfig()

  let projectRoot: string
  try {
    projectRoot = findClaudeProjectDir()
  } catch {
    return defaults
  }
  const configPath = join(projectRoot, '.claude', 'workflows', 'wm.yaml')

  if (!existsSync(configPath)) {
    return defaults
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA }) as WmConfig | null
    if (!parsed || typeof parsed !== 'object') {
      return defaults
    }
    // Merge with defaults (defaults for missing fields)
    return {
      ...defaults,
      ...parsed,
      reviews: {
        ...defaults.reviews,
        ...(parsed.reviews ?? {}),
      },
    }
  } catch {
    return defaults
  }
}
