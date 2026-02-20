// wm status - Show current mode and phase
import { getCurrentSessionId, getStateFilePath } from '../session/lookup.js'
import { readState } from '../state/reader.js'

/**
 * Parse command line arguments for status command
 */
function parseArgs(args: string[]): {
  json?: boolean
  session?: string
} {
  const result: { json?: boolean; session?: string } = {}

  for (const arg of args) {
    if (arg === '--json') {
      result.json = true
    } else if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    }
  }

  return result
}

/**
 * wm status [--json] [--session=SESSION_ID]
 * Shows current mode and phase
 */
export async function status(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  const sessionId = parsed.session || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sessionId)
  const state = await readState(stateFile)

  if (parsed.json) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(
      JSON.stringify(
        {
          sessionId: state.sessionId,
          sessionType: state.sessionType,
          currentMode: state.currentMode,
          currentPhase: state.currentPhase,
          completedPhases: state.completedPhases,
          workflowId: state.workflowId,
          issueNumber: state.issueNumber,
          template: state.template,
          phases: state.phases,
          enteredAt: (() => {
            if (!state.modeHistory || state.modeHistory.length === 0) return undefined
            const lastEntry = state.modeHistory[state.modeHistory.length - 1]
            return typeof lastEntry === 'string' ? undefined : lastEntry.enteredAt
          })(),
          todosWritten: state.todosWritten ?? false,
          todosWrittenAt: state.todosWrittenAt,
        },
        null,
        2,
      ),
    )
  } else {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Mode: ${state.currentMode}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Phase: ${state.currentPhase || 'none'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Workflow ID: ${state.workflowId}`)
    if (state.issueNumber) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(`Issue: #${state.issueNumber}`)
    }
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Template: ${state.template || 'none'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Phases: ${state.phases?.join(', ') || 'none'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Completed: ${state.completedPhases?.join(', ') || 'none'}`)
  }
}
