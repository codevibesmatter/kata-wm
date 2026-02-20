// CLI argument parsing for enter command
import type { SessionState } from '../../state/schema.js'

export interface ParsedArgs {
  mode?: string
  session?: string
  issue?: number
  dryRun?: boolean
  template?: string
  tmp?: boolean
  force?: boolean
  skipCleanup?: boolean
}

/**
 * Parse command line arguments for enter command
 */
export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {}

  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    } else if (arg.startsWith('--issue=')) {
      const issueStr = arg.slice('--issue='.length)
      const issueNum = Number.parseInt(issueStr, 10)
      if (!Number.isNaN(issueNum)) {
        result.issue = issueNum
      }
    } else if (arg === '--dry-run') {
      result.dryRun = true
    } else if (arg === '--tmp') {
      result.tmp = true
    } else if (arg === '--force') {
      result.force = true
    } else if (arg === '--skip-cleanup') {
      result.skipCleanup = true
    } else if (arg.startsWith('--template=')) {
      result.template = arg.slice('--template='.length)
    } else if (!arg.startsWith('--')) {
      // First non-flag argument is the mode
      result.mode = arg
    }
  }

  return result
}

/**
 * Create default state for new sessions
 */
export function createDefaultState(sessionId: string): SessionState {
  return {
    sessionId,
    workflowId: '',
    sessionType: 'default',
    currentMode: 'default',
    completedPhases: [],
    phases: [],
    modeHistory: [],
    modeState: {},
    beadsCreated: [],
    editedFiles: [],
  }
}
