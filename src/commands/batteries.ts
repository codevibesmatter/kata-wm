// wm batteries — scaffold batteries-included content into the current project
// Safe to re-run: never overwrites existing files.
import { join } from 'node:path'
import { scaffoldBatteries } from './scaffold-batteries.js'
import { findClaudeProjectDir } from '../session/lookup.js'

/**
 * wm batteries [--cwd=PATH]
 *
 * Copies batteries-included starter content into the project:
 *   batteries/templates/ → .claude/workflows/templates/
 *   batteries/agents/    → .claude/agents/
 *   batteries/spec-templates/ → planning/spec-templates/
 *
 * Idempotent — skips files that already exist.
 */
export async function batteries(args: string[]): Promise<void> {
  let cwd = process.cwd()

  for (const arg of args) {
    if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length)
    }
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

  const result = scaffoldBatteries(projectRoot)
  const total =
    result.templates.length +
    result.agents.length +
    result.specTemplates.length +
    result.githubTemplates.length

  if (total === 0 && result.skipped.length > 0) {
    process.stdout.write('wm batteries: all files already present (nothing to copy)\n')
    process.stdout.write(`  Skipped: ${result.skipped.join(', ')}\n`)
    return
  }

  process.stdout.write(`wm batteries: scaffolded ${total} files\n`)

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
    process.stdout.write(`\nNext: run 'wm enter setup' to create labels on GitHub\n`)
  }

  if (result.skipped.length > 0) {
    process.stdout.write(`\nSkipped (already exist): ${result.skipped.join(', ')}\n`)
  }

  process.stdout.write('\nDone. Run: wm enter <mode> to get started\n')
}
