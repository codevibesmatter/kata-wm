// scaffold-batteries.ts — copy batteries-included content to a project
// Called by `kata setup --batteries` after base setup completes.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { getPackageRoot, getProjectTemplatesDir, getProjectPromptsDir, getProjectProvidersDir, getProjectInterviewsPath, getProjectSubphasePatternsPath, getProjectVerificationToolsPath, getKataDir } from '../session/lookup.js'
import { getKataConfigPath } from '../config/kata-config.js'

export interface BatteriesResult {
  templates: string[]
  agents: string[]
  prompts: string[]
  providerPlugins: string[]
  specTemplates: string[]
  githubTemplates: string[]
  interviews: string[]
  subphasePatterns: string[]
  verificationTools: string[]
  kataConfig: string[]
  skipped: string[]
  updated: string[]
  backupDir?: string
}

/**
 * Copy all files from srcDir into destDir (one level deep).
 * When update is true, overwrites existing files and reports them as updated.
 * If backupDir is provided, backs up existing files there before overwriting.
 * Otherwise skips existing files.
 */
function copyDirectory(
  srcDir: string,
  destDir: string,
  copied: string[],
  skipped: string[],
  updated: string[],
  update = false,
  backupDir?: string,
): void {
  if (!existsSync(srcDir)) return
  mkdirSync(destDir, { recursive: true })

  for (const file of readdirSync(srcDir)) {
    const src = join(srcDir, file)
    const dest = join(destDir, file)
    if (existsSync(dest)) {
      if (update) {
        if (backupDir) {
          mkdirSync(backupDir, { recursive: true })
          copyFileSync(dest, join(backupDir, file))
        }
        copyFileSync(src, dest)
        updated.push(file)
      } else {
        skipped.push(file)
      }
    } else {
      copyFileSync(src, dest)
      copied.push(file)
    }
  }
}

/**
 * Back up a single file to backupDir before overwriting, if backupDir is set.
 */
function backupFile(filePath: string, backupDir: string, filename: string): void {
  mkdirSync(backupDir, { recursive: true })
  copyFileSync(filePath, join(backupDir, filename))
}

/**
 * Scaffold batteries-included content into a project.
 *
 * Copies from the kata package's batteries/ directory:
 *   batteries/templates/              → .claude/workflows/templates/
 *   batteries/agents/                 → .claude/agents/
 *   batteries/spec-templates/         → planning/spec-templates/
 *   batteries/github/ISSUE_TEMPLATE/  → .github/ISSUE_TEMPLATE/
 *   batteries/github/labels.json      → .github/wm-labels.json  (read by setup mode)
 *
 * Never overwrites existing files — safe to re-run.
 *
 * @param projectRoot - Absolute path to the project root
 * @param update - When true, overwrite existing files instead of skipping them
 */
export function scaffoldBatteries(projectRoot: string, update = false): BatteriesResult {
  const batteryRoot = join(getPackageRoot(), 'batteries')

  // Compute a timestamped backup dir under the kata config dir (only used on --update)
  let backupRoot: string | undefined
  if (update) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19)
    const kd = getKataDir(projectRoot)
    const configBase = kd === '.kata'
      ? join(projectRoot, '.kata')
      : join(projectRoot, '.claude', 'workflows')
    backupRoot = join(configBase, 'batteries-backup', timestamp)
  }

  const result: BatteriesResult = {
    templates: [],
    agents: [],
    prompts: [],
    providerPlugins: [],
    specTemplates: [],
    githubTemplates: [],
    interviews: [],
    subphasePatterns: [],
    verificationTools: [],
    kataConfig: [],
    skipped: [],
    updated: [],
    backupDir: backupRoot,
  }

  // kata.yaml → project config dir
  const kataYamlSrc = join(batteryRoot, 'kata.yaml')
  const kataYamlDest = getKataConfigPath(projectRoot)
  if (existsSync(kataYamlSrc)) {
    if (existsSync(kataYamlDest)) {
      if (update) {
        if (backupRoot) backupFile(kataYamlDest, backupRoot, 'kata.yaml')
        copyFileSync(kataYamlSrc, kataYamlDest)
        result.kataConfig.push('kata.yaml')
        result.updated.push('kata.yaml')
      } else {
        result.skipped.push('kata.yaml')
      }
    } else {
      mkdirSync(dirname(kataYamlDest), { recursive: true })
      copyFileSync(kataYamlSrc, kataYamlDest)
      result.kataConfig.push('kata.yaml')
    }
  }

  // Mode templates → .kata/templates/ (or .claude/workflows/templates/ for old layout)
  copyDirectory(
    join(batteryRoot, 'templates'),
    getProjectTemplatesDir(projectRoot),
    result.templates,
    result.skipped,
    result.updated,
    update,
    backupRoot ? join(backupRoot, 'templates') : undefined,
  )

  // Agent definitions → .claude/agents/
  copyDirectory(
    join(batteryRoot, 'agents'),
    join(projectRoot, '.claude', 'agents'),
    result.agents,
    result.skipped,
    result.updated,
    update,
    backupRoot ? join(backupRoot, 'agents') : undefined,
  )

  // Review prompts → .kata/prompts/ (or .claude/workflows/prompts/ for old layout)
  copyDirectory(
    join(batteryRoot, 'prompts'),
    getProjectPromptsDir(projectRoot),
    result.prompts,
    result.skipped,
    result.updated,
    update,
    backupRoot ? join(backupRoot, 'prompts') : undefined,
  )

  // Provider plugins → .kata/providers/ (example files only, never overwritten)
  copyDirectory(
    join(batteryRoot, 'providers'),
    getProjectProvidersDir(projectRoot),
    result.providerPlugins,
    result.skipped,
    result.updated,
    update,
    backupRoot ? join(backupRoot, 'providers') : undefined,
  )

  // Spec templates → planning/spec-templates/
  copyDirectory(
    join(batteryRoot, 'spec-templates'),
    join(projectRoot, 'planning', 'spec-templates'),
    result.specTemplates,
    result.skipped,
    result.updated,
    update,
    backupRoot ? join(backupRoot, 'spec-templates') : undefined,
  )

  // GitHub issue templates → .github/ISSUE_TEMPLATE/
  copyDirectory(
    join(batteryRoot, 'github', 'ISSUE_TEMPLATE'),
    join(projectRoot, '.github', 'ISSUE_TEMPLATE'),
    result.githubTemplates,
    result.skipped,
    result.updated,
    update,
    backupRoot ? join(backupRoot, 'ISSUE_TEMPLATE') : undefined,
  )

  // labels.json → .github/wm-labels.json (used by onboard mode to create labels)
  const labelsSrc = join(batteryRoot, 'github', 'labels.json')
  const labelsDest = join(projectRoot, '.github', 'wm-labels.json')
  if (existsSync(labelsSrc)) {
    if (existsSync(labelsDest)) {
      if (update) {
        if (backupRoot) backupFile(labelsDest, backupRoot, 'wm-labels.json')
        copyFileSync(labelsSrc, labelsDest)
        result.updated.push('wm-labels.json')
      } else {
        result.skipped.push('wm-labels.json')
      }
    } else {
      mkdirSync(join(projectRoot, '.github'), { recursive: true })
      copyFileSync(labelsSrc, labelsDest)
      result.githubTemplates.push('wm-labels.json')
    }
  }

  // interviews.yaml → .kata/interviews.yaml (or .claude/workflows/interviews.yaml)
  const interviewsSrc = join(batteryRoot, 'interviews.yaml')
  const interviewsDest = getProjectInterviewsPath(projectRoot)
  if (existsSync(interviewsSrc)) {
    if (existsSync(interviewsDest)) {
      if (update) {
        if (backupRoot) backupFile(interviewsDest, backupRoot, 'interviews.yaml')
        copyFileSync(interviewsSrc, interviewsDest)
        result.updated.push('interviews.yaml')
      } else {
        result.skipped.push('interviews.yaml')
      }
    } else {
      // Ensure parent directory exists (resolveKataPath may point to .kata/ or .claude/workflows/)
      mkdirSync(join(interviewsDest, '..'), { recursive: true })
      copyFileSync(interviewsSrc, interviewsDest)
      result.interviews.push('interviews.yaml')
    }
  }

  // subphase-patterns.yaml → .kata/subphase-patterns.yaml (or .claude/workflows/subphase-patterns.yaml)
  const subphaseSrc = join(batteryRoot, 'subphase-patterns.yaml')
  const subphaseDest = getProjectSubphasePatternsPath(projectRoot)
  if (existsSync(subphaseSrc)) {
    if (existsSync(subphaseDest)) {
      if (update) {
        if (backupRoot) backupFile(subphaseDest, backupRoot, 'subphase-patterns.yaml')
        copyFileSync(subphaseSrc, subphaseDest)
        result.updated.push('subphase-patterns.yaml')
      } else {
        result.skipped.push('subphase-patterns.yaml')
      }
    } else {
      mkdirSync(join(subphaseDest, '..'), { recursive: true })
      copyFileSync(subphaseSrc, subphaseDest)
      result.subphasePatterns.push('subphase-patterns.yaml')
    }
  }

  // verification-tools.md → .kata/verification-tools.md (or .claude/workflows/verification-tools.md)
  const vtSrc = join(batteryRoot, 'verification-tools.md')
  const vtDest = getProjectVerificationToolsPath(projectRoot)
  if (existsSync(vtSrc)) {
    if (existsSync(vtDest)) {
      if (update) {
        if (backupRoot) backupFile(vtDest, backupRoot, 'verification-tools.md')
        copyFileSync(vtSrc, vtDest)
        result.updated.push('verification-tools.md')
      } else {
        result.skipped.push('verification-tools.md')
      }
    } else {
      mkdirSync(join(vtDest, '..'), { recursive: true })
      copyFileSync(vtSrc, vtDest)
      result.verificationTools.push('verification-tools.md')
    }
  }

  return result
}

