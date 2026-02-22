// kata config — display resolved configuration with provenance
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir, getUserConfigDir, getPackageRoot } from '../session/lookup.js'
import { loadWmConfig, type WmConfig } from '../config/wm-config.js'
import { loadModesConfig } from '../config/cache.js'

type Provenance = 'default' | 'package' | 'user' | 'project'

/**
 * kata config --show
 *
 * Displays the resolved configuration with provenance annotations
 * showing which layer each value came from.
 */
export async function config(args: string[]): Promise<void> {
  if (args.includes('--show') || args.length === 0) {
    await showConfig()
  } else {
    process.stdout.write('Usage: kata config --show\n')
  }
}

async function showConfig(): Promise<void> {
  // Load the resolved config
  const resolved = loadWmConfig()

  // Load each layer independently for provenance
  const userConfigPath = join(getUserConfigDir(), 'wm.yaml')
  const userConfig = loadYamlFile(userConfigPath)

  let projectConfig: WmConfig | null = null
  try {
    const projectRoot = findClaudeProjectDir()
    const projectPath = join(projectRoot, '.claude', 'workflows', 'wm.yaml')
    projectConfig = loadYamlFile(projectPath)
  } catch {
    // No project
  }

  // Show scalar fields with provenance
  process.stdout.write('kata config (resolved)\n')
  process.stdout.write('═'.repeat(60) + '\n\n')

  showField('spec_path', resolved.spec_path, userConfig?.spec_path, projectConfig?.spec_path, 'planning/specs')
  showField('research_path', resolved.research_path, userConfig?.research_path, projectConfig?.research_path, 'planning/research')
  showField('session_retention_days', resolved.session_retention_days, userConfig?.session_retention_days, projectConfig?.session_retention_days, 7)
  showField('hooks_dir', resolved.hooks_dir, userConfig?.hooks_dir, projectConfig?.hooks_dir, '.claude/hooks')
  showField('wm_version', resolved.wm_version, userConfig?.wm_version, projectConfig?.wm_version, undefined)
  showField('verify_command', resolved.verify_command, userConfig?.verify_command, projectConfig?.verify_command, undefined)

  // Reviews section
  if (resolved.reviews) {
    process.stdout.write('\nreviews:\n')
    showField('  spec_review', resolved.reviews.spec_review, userConfig?.reviews?.spec_review, projectConfig?.reviews?.spec_review, false)
    showField('  code_reviewer', resolved.reviews.code_reviewer, userConfig?.reviews?.code_reviewer, projectConfig?.reviews?.code_reviewer, null)
  }

  // Project section
  if (resolved.project) {
    process.stdout.write('\nproject:\n')
    showField('  name', resolved.project.name, undefined, projectConfig?.project?.name, undefined)
    showField('  test_command', resolved.project.test_command, undefined, projectConfig?.project?.test_command, undefined)
    showField('  build_command', resolved.project.build_command, undefined, projectConfig?.project?.build_command, undefined)
  }

  // Modes summary
  process.stdout.write('\n')
  const modesConfig = await loadModesConfig()
  const modeNames = Object.keys(modesConfig.modes).filter(
    (m) => !modesConfig.modes[m].deprecated,
  )
  process.stdout.write(`modes: ${modeNames.length} active modes\n`)

  // Template resolution summary
  process.stdout.write('\ntemplates (lookup order: project → user → package):\n')
  const userTemplateDir = join(getUserConfigDir(), 'templates')
  const packageTemplateDir = join(getPackageRoot(), 'batteries', 'templates')
  try {
    const projectRoot = findClaudeProjectDir()
    const projTmplDir = join(projectRoot, '.claude', 'workflows', 'templates')
    process.stdout.write(`  project:  ${projTmplDir} ${existsSync(projTmplDir) ? '(exists)' : '(not found)'}\n`)
  } catch {
    process.stdout.write('  project:  (no project)\n')
  }
  process.stdout.write(`  user:     ${userTemplateDir} ${existsSync(userTemplateDir) ? '(exists)' : '(not found)'}\n`)
  process.stdout.write(`  package:  ${packageTemplateDir} ${existsSync(packageTemplateDir) ? '(exists)' : '(not found)'}\n`)
}

function showField(
  name: string,
  resolved: unknown,
  userVal: unknown,
  projectVal: unknown,
  defaultVal: unknown,
): void {
  const provenance = getProvenance(resolved, userVal, projectVal, defaultVal)
  const displayVal = resolved === null ? 'null' : resolved === undefined ? '(not set)' : String(resolved)
  process.stdout.write(`${name}: ${displayVal}  (${provenance})\n`)
}

function getProvenance(
  resolved: unknown,
  userVal: unknown,
  projectVal: unknown,
  defaultVal: unknown,
): Provenance {
  if (projectVal !== undefined) return 'project'
  if (userVal !== undefined) return 'user'
  if (resolved === defaultVal) return 'default'
  return 'default'
}

function loadYamlFile(filePath: string): WmConfig | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA }) as WmConfig | null
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}
