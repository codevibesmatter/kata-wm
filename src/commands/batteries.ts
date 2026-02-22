// kata batteries — scaffold batteries-included content into a project or user config dir
// Default: skips existing files. Use --update to overwrite with latest versions.
// Use --user to seed user-level config at ~/.config/kata/ instead of project.
import { scaffoldBatteries, scaffoldUserBatteries } from './scaffold-batteries.js'
import { findClaudeProjectDir, getUserConfigDir } from '../session/lookup.js'

/**
 * kata batteries [--update] [--user] [--cwd=PATH]
 *
 * Project mode (default):
 *   batteries/templates/       → .claude/workflows/templates/
 *   batteries/agents/          → .claude/agents/
 *   batteries/spec-templates/  → planning/spec-templates/
 *   batteries/github/          → .github/
 *
 * User mode (--user):
 *   batteries/templates/       → ~/.config/kata/templates/
 *   batteries/spec-templates/  → ~/.config/kata/spec-templates/
 *
 * By default skips files that already exist.
 * Use --update to overwrite existing files with the latest package versions.
 */
export async function batteries(args: string[]): Promise<void> {
  let cwd = process.cwd()
  let update = false
  let userMode = false

  for (const arg of args) {
    if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length)
    } else if (arg === '--update') {
      update = true
    } else if (arg === '--user') {
      userMode = true
    }
  }

  if (userMode) {
    return batteriesUser(update)
  }

  // Resolve project root — explicit cwd wins, then walk up for .claude/
  let projectRoot = cwd
  if (!args.some((a) => a.startsWith('--cwd='))) {
    try {
      projectRoot = findClaudeProjectDir()
    } catch {
      // No .claude/ found — use cwd
    }
  }

  const result = scaffoldBatteries(projectRoot, update)
  const newCount =
    result.templates.length +
    result.agents.length +
    result.specTemplates.length +
    result.githubTemplates.length
  const updatedCount = result.updated.length

  if (newCount === 0 && updatedCount === 0 && result.skipped.length > 0) {
    process.stdout.write('kata batteries: all files already present (nothing to copy)\n')
    process.stdout.write(`  Re-run with --update to overwrite with latest versions\n`)
    return
  }

  if (update) {
    process.stdout.write(`kata batteries --update: ${newCount} new, ${updatedCount} updated\n`)
  } else {
    process.stdout.write(`kata batteries: scaffolded ${newCount} files\n`)
  }

  if (result.templates.length > 0) {
    process.stdout.write(`\nMode templates → .claude/workflows/templates/\n`)
    for (const f of result.templates) process.stdout.write(`  ${f}\n`)
  }
  if (result.agents.length > 0) {
    process.stdout.write(`\nAgents → .claude/agents/\n`)
    for (const f of result.agents) process.stdout.write(`  ${f}\n`)
  }
  if (result.specTemplates.length > 0) {
    process.stdout.write(`\nSpec templates → planning/spec-templates/\n`)
    for (const f of result.specTemplates) process.stdout.write(`  ${f}\n`)
  }
  if (result.githubTemplates.length > 0) {
    process.stdout.write(`\nGitHub → .github/\n`)
    for (const f of result.githubTemplates) process.stdout.write(`  ${f}\n`)
    process.stdout.write(`\nNext: run 'kata enter onboard' to create labels on GitHub\n`)
  }
  if (result.updated.length > 0) {
    process.stdout.write(`\nUpdated (overwritten):\n`)
    for (const f of result.updated) process.stdout.write(`  ${f}\n`)
  }
  if (result.skipped.length > 0) {
    process.stdout.write(`\nSkipped (already exist): ${result.skipped.join(', ')}\n`)
  }

  process.stdout.write('\nDone. Run: kata enter <mode> to get started\n')
}

/**
 * Scaffold batteries content into user config dir (~/.config/kata/)
 */
function batteriesUser(update: boolean): void {
  const userDir = getUserConfigDir()
  const result = scaffoldUserBatteries(update)
  const newCount = result.templates.length + result.specTemplates.length
  const updatedCount = result.updated.length

  if (newCount === 0 && updatedCount === 0 && result.skipped.length > 0) {
    process.stdout.write(`kata batteries --user: all files already present at ${userDir}\n`)
    process.stdout.write(`  Re-run with --update to overwrite with latest versions\n`)
    return
  }

  if (update) {
    process.stdout.write(
      `kata batteries --user --update: ${newCount} new, ${updatedCount} updated → ${userDir}\n`,
    )
  } else {
    process.stdout.write(
      `kata batteries --user: scaffolded ${newCount} files → ${userDir}\n`,
    )
  }

  if (result.templates.length > 0) {
    process.stdout.write(`\nMode templates → ${userDir}/templates/\n`)
    for (const f of result.templates) process.stdout.write(`  ${f}\n`)
  }
  if (result.specTemplates.length > 0) {
    process.stdout.write(`\nSpec templates → ${userDir}/spec-templates/\n`)
    for (const f of result.specTemplates) process.stdout.write(`  ${f}\n`)
  }
  if (result.updated.length > 0) {
    process.stdout.write(`\nUpdated (overwritten):\n`)
    for (const f of result.updated) process.stdout.write(`  ${f}\n`)
  }
  if (result.skipped.length > 0) {
    process.stdout.write(`\nSkipped (already exist): ${result.skipped.join(', ')}\n`)
  }

  process.stdout.write('\nDone. User-level templates will apply to all projects.\n')
}
