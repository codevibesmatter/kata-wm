#!/usr/bin/env node

/**
 * wm - Workflow Management CLI
 *
 * Type-safe state management for Claude Code workflow sessions.
 */

import { enter } from './commands/enter.js'
import { status } from './commands/status.js'
import { exit } from './commands/exit.js'
import { canExit } from './commands/can-exit.js'
import { prompt } from './commands/prompt.js'
import { init } from './commands/init.js'
import { prime } from './commands/prime.js'
import { validateSpecCommand } from './commands/validate-spec.js'
import { validateTemplateCommand } from './commands/validate-template.js'
import { initTemplateCommand } from './commands/init-template.js'
import { initModeCommand } from './commands/init-mode.js'
import { registerModeCommand } from './commands/register-mode.js'
import { doctor } from './commands/doctor.js'
import { link } from './commands/link.js'
import { suggest } from './commands/suggest.js'
import { setup } from './commands/setup.js'
import { teardown } from './commands/teardown.js'
import { hook } from './commands/hook.js'
import { batteries } from './commands/batteries.js'
import { modes } from './commands/modes.js'
import { verifyPhase } from './commands/verify-phase.js'
import { providers as providersCommand } from './commands/providers.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPackageRoot } from './session/lookup.js'

/**
 * Read package version from package.json
 */
function getVersion(): string {
  try {
    const pkgPath = join(getPackageRoot(), 'package.json')
    if (existsSync(pkgPath)) {
      const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
      if (parsed.version) return parsed.version
    }
  } catch {
    // Fall through
  }
  return '0.0.0'
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'help'
  const commandArgs = args.slice(1)

  try {
    switch (command) {
      case 'enter':
        await enter(commandArgs)
        break

      case 'status':
        await status(commandArgs)
        break

      case 'advance':
        // Deprecated: Phase advancement is now done by completing native tasks
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('DEPRECATED: wm advance is no longer used.')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(
          'Phase advancement is tracked via native tasks. Use TaskUpdate(taskId="X", status="completed") to advance.',
        )
        process.exitCode = 1
        break

      case 'exit':
        await exit(commandArgs)
        break

      case 'can-exit':
        await canExit(commandArgs)
        break

      case 'prompt':
        await prompt(commandArgs)
        break

      case 'init':
        await init(commandArgs)
        break

      case 'prime':
        await prime(commandArgs)
        break

      case 'validate-spec':
        await validateSpecCommand(commandArgs)
        break

      case 'validate-template':
        await validateTemplateCommand(commandArgs)
        break

      case 'init-template':
        await initTemplateCommand(commandArgs)
        break

      case 'init-mode':
        await initModeCommand(commandArgs)
        break

      case 'register-mode':
        await registerModeCommand(commandArgs)
        break

      case 'doctor':
        await doctor(commandArgs)
        break

      case 'link':
        await link(commandArgs)
        break

      case 'suggest':
        await suggest(commandArgs)
        break

      case 'setup':
        await setup(commandArgs)
        break

      case 'teardown':
        await teardown(commandArgs)
        break

      case 'batteries':
        await batteries(commandArgs)
        break

      case 'modes':
        await modes(commandArgs)
        break

      case 'verify-phase':
        await verifyPhase(commandArgs)
        break

      case 'providers':
        await providersCommand(commandArgs)
        break

      case 'hook':
        await hook(commandArgs)
        break

      case '--version':
      case '-v':
      case 'version':
        process.stdout.write(`${getVersion()}\n`)
        break

      case 'help':
      case '--help':
      case '-h':
        showHelp()
        break

      default:
        // biome-ignore lint/suspicious/noConsole: intentional for CLI
        console.error(`Unknown command: ${command}`)
        // biome-ignore lint/suspicious/noConsole: intentional for CLI
        console.error('Run: wm help')
        process.exit(1)
    }
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: intentional for CLI
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

function showHelp() {
  // biome-ignore lint/suspicious/noConsole: intentional for CLI output
  console.log(`
kata - Workflow kata CLI

Usage:
  kata enter <mode> [--session=SESSION_ID]       Enter a mode (creates native tasks)
  kata enter --template=PATH [--dry-run]         Use custom template for one-off session
  kata enter --template=PATH --tmp               One-off session (tracked, not registered)
  kata status [--json] [--session=SESSION_ID]    Show current mode and phase
  kata link [<issue>]                            Show linked issue (or link new issue)
  kata link --show                               Show currently linked issue
  kata link --clear                              Clear issue linkage
  kata exit [--session=SESSION_ID]               Exit current mode
  kata can-exit [--json] [--session=SESSION_ID]  Check if exit conditions met (native tasks)
  kata prompt [--session=SESSION_ID]             Output current mode prompt
  kata init [--session=SESSION_ID] [--force]     Initialize session state
  kata prime [--session=ID] [--hook-json]        Output context injection block
  kata verify-phase <phase-id> [--issue=N] [--force]  Run per-phase verification
  kata validate-spec --issue=N | path.md         Validate spec phases format
  kata validate-template <path> [--json]         Validate a template file
  kata init-template <path> [options]            Create a new template file
  kata init-mode <name> [options]                Create new mode (template + modes.yaml)
  kata register-mode <template-path> [options]   Register existing template as mode
  kata suggest <message>                         Detect mode from message, output guidance
  kata doctor [--fix] [--json]                   Diagnose and fix session state
  kata setup [--yes] [--strict] [--batteries]    Setup kata in a project
  kata batteries [--update] [--cwd=PATH]         Scaffold batteries-included starter content
  kata providers [list|setup] [--json]             Check/configure agent providers
  kata teardown [--yes] [--all] [--dry-run]      Remove kata from a project
  kata hook <name>                               Dispatch hook event (for settings.json)
  kata --version                                 Show version
  kata help                                      Show this help

Hook Dispatch:
  kata hook session-start         Initialize session + inject context (SessionStart)
  kata hook user-prompt           Detect mode from user message (UserPromptSubmit)
  kata hook mode-gate             Block writes without active mode (PreToolUse)
  kata hook task-deps             Check task dependencies (PreToolUse:TaskUpdate)
  kata hook task-evidence         Check git status for evidence (PreToolUse:TaskUpdate)
  kata hook stop-conditions       Check exit conditions (Stop)

Setup:
  kata setup --yes                Quick setup with auto-detected defaults
  kata setup --yes --strict       Setup with PreToolUse gate hooks
  kata setup --batteries          Setup + scaffold batteries-included starter content (implies --yes)
  kata setup --batteries --strict Setup + batteries + strict PreToolUse hooks
  kata enter onboard                Guided setup interview (interactive, agent-driven)
  kata batteries                  Scaffold batteries content only (idempotent, skips existing)
  kata batteries --update         Re-scaffold batteries, overwriting with latest versions
  kata teardown --yes             Remove kata hooks and config
  kata teardown --dry-run         Preview what would be removed

Task Tracking:
  Tasks are managed via Claude Code's native task system (~/.claude/tasks/{session}/).
  - kata enter creates native tasks from template (TaskCreate)
  - kata can-exit checks for pending native tasks
  - Use TaskUpdate(taskId="X", status="completed") to complete tasks

Examples:
  kata enter implementation   # Enter mode, creates native tasks
  kata status --json          # Check current state
  TaskList                    # View all tasks
  TaskUpdate                  # Complete a task
  kata can-exit               # Check if all tasks completed
  kata exit                   # Complete mode

Custom Templates (one-off sessions):
  kata init-template /tmp/my-workflow.md --phases=4
  kata validate-template /tmp/my-workflow.md
  kata enter --template=/tmp/my-workflow.md             # Track with tasks
  kata enter --template=/tmp/my-workflow.md --dry-run   # Preview only
  kata enter --template=/tmp/my-workflow.md --tmp       # One-off (tracked, not registered)

Permanent Modes (saved in modes.yaml):
  kata init-mode code-review                            # Create new mode + template
  kata init-mode sprint-planning --phases=5             # With custom phase count
  kata register-mode /tmp/my-workflow.md --copy         # Register existing template

Issue Linking:
  kata enter implementation --issue=123         Link issue when entering mode
  kata link 456                                 Link to different issue mid-session
  kata link --show                              Check current linkage
  kata link --clear                             Clear issue linkage

State Management:
  kata init --force                              Reset session state to defaults
  kata exit                                      Mark current mode complete, reset to default

Troubleshooting:
  - Switching issues? Use 'kata link <new-issue>' or 'kata enter <mode> --issue=N'
  - State corrupted? Use 'kata init --force' to hard reset
  - Task issues? Use TaskList to see native tasks

Notes:
  - If --session not provided, uses current session from .claude/current-session-id
  - JSON output is for hooks, human-readable output is default
  - State stored at .claude/sessions/{SESSION_ID}/state.json
  - Native tasks stored at ~/.claude/tasks/{SESSION_ID}/
`)
}

main()

// Export types and utilities for programmatic use
export * from './state/schema.js'
export * from './state/reader.js'
export * from './state/writer.js'
export * from './state/validator.js'
export * from './utils/workflow-id.js'
export * from './utils/timestamp.js'
export * from './config/parser.js'
export * from './config/cache.js'
export * from './session/lookup.js'
export * from './validation/index.js'

// Agent providers
export {
  getProvider,
  registerProvider,
  listProviders,
  preparePrompt,
  loadPrompt,
  listPrompts,
  claudeProvider,
  geminiProvider,
  codexProvider,
} from './providers/index.js'
export type { AgentProvider, AgentRunOptions } from './providers/types.js'
export type { PreparedPrompt } from './providers/prompt.js'
