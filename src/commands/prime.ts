// wm prime - Output context injection block
import { getCurrentSessionId, getStateFilePath, resolveTemplatePath } from '../session/lookup.js'
import { readState, stateExists } from '../state/reader.js'
import { readFullTemplateContent } from '../yaml/index.js'
import { loadModesConfig } from '../config/cache.js'
import { loadWmConfig } from '../config/wm-config.js'

/**
 * Parse command line arguments for prime command
 */
function parseArgs(args: string[]): {
  session?: string
  hookJson?: boolean
} {
  const result: { session?: string; hookJson?: boolean } = {}

  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    } else if (arg === '--hook-json') {
      result.hookJson = true
    }
  }

  return result
}

/**
 * Output mode selection help when no mode is active
 * Reads available modes from modes.yaml dynamically
 */
async function buildModeSelectionHelp(): Promise<string> {
  // Load modes from modes.yaml (with project-level override if present)
  const config = await loadModesConfig()

  // Get all mode names (sorted, non-deprecated, non-system)
  const allModes = Object.keys(config.modes)
    .filter((m) => !config.modes[m].deprecated && config.modes[m].category !== 'system')
    .sort()
    .join(', ')

  // Build table
  const modeTable = Object.entries(config.modes)
    .filter(([_, cfg]) => !cfg.deprecated && cfg.category !== 'system')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cfg]) => `| \`${name}\` | ${cfg.description || ''} |`)
    .join('\n')

  return `# MODE ENTRY IS MANDATORY

**CRITICAL**: Before doing ANY work, you MUST enter a mode.

## Available Modes

${allModes}

## Quick Reference

| Mode | Description |
|------|-------------|
${modeTable}

## Task Size -> Mode Selection

| Task Size | Mode | Issue Required? | Example |
|-----------|------|-----------------|---------|
| **Small** (<1 hr) | \`task\` | No | Add CLI command, small refactor |
| **Medium** (hours) | \`implementation\` | **Yes** | Feature work from approved spec |
| **Large** (days) | \`planning\` first | **Yes** | New features, architecture |
| **Questions** | \`freeform\` | No | "How does X work?" |

## Classify User Intent

| User Says | Intent | Mode |
|-----------|--------|------|
| "add X to CLI", "quick change", "small refactor" | SMALL TASK | \`task\` |
| "implement issue #123", "build feature from spec" | SPEC WORK | \`implementation\` |
| "bug: ...", "fix #456", "broken ..." | BUG FIX | \`bugfix\` |
| "plan ...", "design ...", "spec ..." | PLANNING | \`planning\` |
| "how does ...", "what is ...", "explain ..." | QUESTION | \`freeform\` |
| "research ...", "comprehensive exploration" | RESEARCH | \`research\` |
| "investigate ...", "why is ...", "debug ..." | DEBUG | \`debug\` |

## Commands

\`\`\`bash
kata enter <mode>                       # Enter a mode
kata enter implementation --issue=123  # Issue-backed from spec
kata link <issue-num>                   # Link session to issue mid-session
kata status                             # Check current mode and phase
kata can-exit                           # Check stop conditions
\`\`\`

**NEVER skip mode entry.** Work without a mode loses tracking, context, and guidance.`
}

/**
 * Build full context block for prime output
 */
async function buildContextBlock(sessionId: string): Promise<string> {
  const contextParts: string[] = []
  const stateFile = await getStateFilePath(sessionId)

  if (await stateExists(stateFile)) {
    const state = await readState(stateFile)

    // If we have a current mode with a template, output the full template content
    if (state.currentMode && state.currentMode !== 'default' && state.template) {
      try {
        const templatePath = resolveTemplatePath(state.template)
        const templateContent = readFullTemplateContent(templatePath)

        if (templateContent) {
          contextParts.push(`# Active Mode: ${state.currentMode}`)
          if (state.workflowId) {
            contextParts.push(`# Workflow: ${state.workflowId}`)
          }
          if (state.issueNumber) {
            contextParts.push(`# Issue: #${state.issueNumber}`)
          }
          if (state.currentPhase) {
            contextParts.push(`# Current Phase: ${state.currentPhase}`)
          }
          contextParts.push('')
          contextParts.push('---')
          contextParts.push('')
          contextParts.push(templateContent)

          // Ledger context
          if (state.ledger) {
            const ledgerParts: string[] = []
            if (state.ledger.decisions?.length) {
              ledgerParts.push('## Decisions')
              for (const d of state.ledger.decisions) {
                ledgerParts.push(`- ${d}`)
              }
            }
            if (state.ledger.discoveries?.length) {
              ledgerParts.push('## Discoveries')
              for (const d of state.ledger.discoveries) {
                ledgerParts.push(`- ${d}`)
              }
            }
            if (state.ledger.corrections?.length) {
              ledgerParts.push('## Corrections')
              for (const c of state.ledger.corrections) {
                ledgerParts.push(`- ${c}`)
              }
            }
            if (ledgerParts.length > 0) {
              contextParts.push('')
              contextParts.push('---')
              contextParts.push('# Session Ledger')
              contextParts.push(...ledgerParts)
            }
          }

          // Prime extensions from wm.yaml
          try {
            const wmConfig = loadWmConfig()
            if (wmConfig.prime_extensions?.length) {
              contextParts.push('')
              contextParts.push('---')
              contextParts.push('# Project Extensions')
              for (const ext of wmConfig.prime_extensions) {
                contextParts.push(ext)
              }
            }
          } catch {
            // Config not available, skip
          }

          return contextParts.join('\n')
        }
      } catch {
        // Template not found, fall through to mode selection help
      }
    }
  }

  // No active mode or no template - show mode selection help
  const modeHelp = await buildModeSelectionHelp()
  return modeHelp
}

/**
 * wm prime [--session=ID] [--hook-json]
 * Outputs context injection block (like bt prime, bpd prime)
 *
 * When --hook-json is passed, outputs valid Claude Code hook JSON:
 * { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '...' } }
 *
 * If in a mode with a template, outputs the FULL template content.
 * Otherwise outputs mode selection help.
 */
export async function prime(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  try {
    const sessionId = parsed.session || (await getCurrentSessionId())
    const contextBlock = await buildContextBlock(sessionId)

    if (parsed.hookJson) {
      // Output as Claude Code hook JSON
      const output = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: contextBlock,
        },
      }
      process.stdout.write(`${JSON.stringify(output)}\n`)
    } else {
      // Output as plain text
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(contextBlock)
    }
  } catch {
    // No session - show mode selection help
    const modeHelp = await buildModeSelectionHelp()

    if (parsed.hookJson) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: modeHelp,
        },
      }
      process.stdout.write(`${JSON.stringify(output)}\n`)
    } else {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(modeHelp)
    }
  }
}
