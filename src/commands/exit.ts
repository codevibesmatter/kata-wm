// wm exit - Exit current mode
import { getCurrentSessionId, getStateFilePath } from '../session/lookup.js'
import { readState } from '../state/reader.js'
import { writeState } from '../state/writer.js'
import type { SessionState } from '../state/schema.js'

/**
 * Parse command line arguments for exit command
 */
function parseArgs(args: string[]): {
  session?: string
} {
  const result: { session?: string } = {}

  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    }
  }

  return result
}

/**
 * wm exit [--session=SESSION_ID]
 * Mark mode complete, return to previous
 */
export async function exit(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  const sessionId = parsed.session || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sessionId)
  const state = await readState(stateFile)

  const completedMode = state.currentMode
  const now = new Date().toISOString()

  const updated: SessionState = {
    ...state,
    previousMode: completedMode,
    currentMode: 'default',
    sessionType: 'default',
    currentPhase: undefined,
    workflowCompletedAt: now,
    ...(completedMode && {
      modeState: {
        ...(state.modeState || {}),
        [completedMode]: {
          ...state.modeState?.[completedMode],
          status: 'completed' as const,
          exitedAt: now,
          enteredAt: state.modeState?.[completedMode]?.enteredAt || now,
        },
      },
    }),
    modeHistory: state.modeHistory?.map((h) => {
      // Handle both string (legacy) and object (new) formats
      if (typeof h === 'string') {
        return h
      }
      return h.mode === completedMode && !h.exitedAt ? { ...h, exitedAt: now } : h
    }),
    updatedAt: now,
  }

  await writeState(stateFile, updated)

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    JSON.stringify(
      {
        success: true,
        completedMode,
        completedAt: now,
      },
      null,
      2,
    ),
  )
}
