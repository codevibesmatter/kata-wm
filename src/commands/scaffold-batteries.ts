// scaffold-batteries.ts — copy batteries-included content to a project
// Called by `wm setup --batteries` after base setup completes.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getPackageRoot } from '../session/lookup.js'

export interface BatteriesResult {
  templates: string[]
  agents: string[]
  specTemplates: string[]
  githubTemplates: string[]
  skipped: string[]
}

/**
 * Copy all files from srcDir into destDir (one level deep).
 * Skips files that already exist in destDir (never overwrites).
 */
function copyDirectory(
  srcDir: string,
  destDir: string,
  copied: string[],
  skipped: string[],
): void {
  if (!existsSync(srcDir)) return
  mkdirSync(destDir, { recursive: true })

  for (const file of readdirSync(srcDir)) {
    const src = join(srcDir, file)
    const dest = join(destDir, file)
    if (existsSync(dest)) {
      skipped.push(file)
    } else {
      copyFileSync(src, dest)
      copied.push(file)
    }
  }
}

/**
 * Scaffold batteries-included content into a project.
 *
 * Copies from the wm package's batteries/ directory:
 *   batteries/templates/              → .claude/workflows/templates/
 *   batteries/agents/                 → .claude/agents/
 *   batteries/spec-templates/         → planning/spec-templates/
 *   batteries/github/ISSUE_TEMPLATE/  → .github/ISSUE_TEMPLATE/
 *   batteries/github/labels.json      → .github/wm-labels.json  (read by setup mode)
 *
 * Never overwrites existing files — safe to re-run.
 *
 * @param projectRoot - Absolute path to the project root
 */
export function scaffoldBatteries(projectRoot: string): BatteriesResult {
  const batteryRoot = join(getPackageRoot(), 'batteries')
  const result: BatteriesResult = {
    templates: [],
    agents: [],
    specTemplates: [],
    githubTemplates: [],
    skipped: [],
  }

  // Mode templates → .claude/workflows/templates/
  copyDirectory(
    join(batteryRoot, 'templates'),
    join(projectRoot, '.claude', 'workflows', 'templates'),
    result.templates,
    result.skipped,
  )

  // Agent definitions → .claude/agents/
  copyDirectory(
    join(batteryRoot, 'agents'),
    join(projectRoot, '.claude', 'agents'),
    result.agents,
    result.skipped,
  )

  // Spec templates → planning/spec-templates/
  copyDirectory(
    join(batteryRoot, 'spec-templates'),
    join(projectRoot, 'planning', 'spec-templates'),
    result.specTemplates,
    result.skipped,
  )

  // GitHub issue templates → .github/ISSUE_TEMPLATE/
  copyDirectory(
    join(batteryRoot, 'github', 'ISSUE_TEMPLATE'),
    join(projectRoot, '.github', 'ISSUE_TEMPLATE'),
    result.githubTemplates,
    result.skipped,
  )

  // labels.json → .github/wm-labels.json (used by setup mode to create labels)
  const labelsSrc = join(batteryRoot, 'github', 'labels.json')
  const labelsDest = join(projectRoot, '.github', 'wm-labels.json')
  if (existsSync(labelsSrc)) {
    if (existsSync(labelsDest)) {
      result.skipped.push('wm-labels.json')
    } else {
      mkdirSync(join(projectRoot, '.github'), { recursive: true })
      copyFileSync(labelsSrc, labelsDest)
      result.githubTemplates.push('wm-labels.json')
    }
  }

  return result
}
