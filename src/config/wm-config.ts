import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir } from '../session/lookup.js'

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
