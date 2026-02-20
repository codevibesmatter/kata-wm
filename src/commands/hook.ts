// wm hook <name> - Hook event dispatch
// Core of hooks-as-commands architecture: each hook event has a handler function
// that reads stdin JSON, performs the check, and outputs Claude Code hook JSON.
import { execSync } from 'node:child_process'
import { getStateFilePath, findClaudeProjectDir } from '../session/lookup.js'
import { readState, stateExists } from '../state/reader.js'
import { loadModesConfig } from '../config/cache.js'
import { loadWmConfig } from '../config/wm-config.js'
import { readNativeTaskFiles } from './enter/task-factory.js'
import type { SessionState } from '../state/schema.js'

/**
 * Claude Code hook output format
 *
 * Decision hooks (PreToolUse, Stop): decision goes at TOP LEVEL, lowercase
 * Context hooks (SessionStart, UserPromptSubmit): use hookSpecificOutput
 */
type HookOutput =
  | {
      decision: 'block' | 'allow'
      reason?: string
    }
  | {
      hookSpecificOutput: {
        hookEventName: string
        additionalContext?: string
      }
    }

/**
 * Read stdin as JSON (for hook input)
 */
async function readStdinJson(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    const stdin = process.stdin
    stdin.setEncoding('utf-8')

    // Handle case where stdin is not a TTY (piped data)
    if (stdin.isTTY) {
      resolve({})
      return
    }

    stdin.on('data', (chunk) => {
      data += chunk
    })

    stdin.on('end', () => {
      if (!data.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(data) as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })

    // Timeout after 1 second if no data
    setTimeout(() => {
      stdin.removeAllListeners()
      if (!data.trim()) {
        resolve({})
      } else {
        try {
          resolve(JSON.parse(data) as Record<string, unknown>)
        } catch {
          resolve({})
        }
      }
    }, 1000)
  })
}

/**
 * Safely get session state from a session ID extracted from hook stdin JSON.
 * Returns null if sessionId is missing or state doesn't exist.
 */
async function getSessionState(
  sessionId: string | undefined,
): Promise<{ state: SessionState; sessionId: string } | null> {
  if (!sessionId) return null
  try {
    const stateFile = await getStateFilePath(sessionId)
    if (await stateExists(stateFile)) {
      const state = await readState(stateFile)
      return { state, sessionId }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Output JSON to stdout
 */
function outputJson(obj: HookOutput): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

/**
 * Capture console.log output from a function that writes to console.log
 * Replaces console.log temporarily and returns captured output
 */
async function captureConsoleLog(fn: () => Promise<void>): Promise<string> {
  let captured = ''
  // biome-ignore lint/suspicious/noConsole: intentional capture of console.log output for hook dispatch
  const origLog = console.log
  console.log = (...args: unknown[]) => {
    captured += args.map(String).join(' ')
  }
  try {
    await fn()
  } finally {
    console.log = origLog
  }
  return captured
}

// ── Handler: session-start ──
// Calls init then prime — initializes session state and outputs context
async function handleSessionStart(input: Record<string, unknown>): Promise<void> {
  const sessionId = input.session_id as string | undefined
  const source = (input.source as string) ?? 'startup'

  // Import and run init (silently capture its output)
  const { init } = await import('./init.js')
  const initArgs: string[] = []
  if (sessionId) initArgs.push(`--session=${sessionId}`)
  if (source) initArgs.push(`--source=${source}`)
  await captureConsoleLog(() => init(initArgs))

  // Now build prime context
  const contextParts: string[] = []

  // Session state context
  const session = await getSessionState(sessionId)
  if (session) {
    const { state } = session
    if (state.currentMode && state.currentMode !== 'default') {
      contextParts.push(`Active mode: ${state.currentMode}`)
      if (state.currentPhase) {
        contextParts.push(`Current phase: ${state.currentPhase}`)
      }
      if (state.issueNumber) {
        contextParts.push(`Linked issue: #${state.issueNumber}`)
      }
    }
  }

  // Mode selection help (always include available modes summary)
  try {
    const config = await loadModesConfig()
    const modeList = Object.entries(config.modes)
      .filter(([_, m]) => !m.deprecated)
      .map(([id, m]) => `${id}: ${m.description}`)
      .join('\n')
    contextParts.push(`\nAvailable modes:\n${modeList}`)
  } catch {
    // Config not available, skip
  }

  // Prime extensions from wm.yaml
  try {
    const wmConfig = loadWmConfig()
    if (wmConfig.prime_extensions?.length) {
      contextParts.push('\n--- Project Extensions ---')
      for (const ext of wmConfig.prime_extensions) {
        contextParts.push(ext)
      }
    }
  } catch {
    // Config not available, skip
  }

  // Continuation warning for resumed sessions
  if (source === 'resume' || source === 'compact') {
    contextParts.push('\n--- Session Continuation ---')
    contextParts.push(
      `This session was ${source === 'resume' ? 'resumed' : 'compacted'}. Check session state with: wm status`,
    )
  }

  outputJson({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: contextParts.join('\n'),
    },
  })
}

// ── Handler: user-prompt ──
// Calls suggest to detect mode from user message
async function handleUserPrompt(input: Record<string, unknown>): Promise<void> {
  const message = (input.user_message as string) ?? (input.prompt as string) ?? ''

  // Import and call suggest logic, capturing its console output
  const { suggest } = await import('./suggest.js')
  const suggestOutput = await captureConsoleLog(() => suggest(message.split(' ')))

  let additionalContext = ''
  try {
    const result = JSON.parse(suggestOutput) as {
      mode: string | null
      guidance: string
      command: string | null
    }
    if (result.guidance) {
      additionalContext = result.guidance
    }
  } catch {
    // Could not parse suggest output
  }

  outputJson({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  })
}

// ── Handler: mode-gate ──
// Checks mode state for PreToolUse gating
async function handleModeGate(input: Record<string, unknown>): Promise<void> {
  const session = await getSessionState(input.session_id as string | undefined)

  if (!session) {
    // No session state — allow (don't block new projects)
    outputJson({ decision: 'allow' })
    return
  }

  const { state } = session
  const toolName = (input.tool_name as string) ?? ''

  // If in default mode (no mode entered), block write operations.
  // These are Claude Code's internal tool_name values for file-mutation operations.
  if (state.currentMode === 'default' || !state.currentMode) {
    const writeTools = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
    if (writeTools.includes(toolName)) {
      outputJson({
        decision: 'block',
        reason: 'Enter a mode first: wm enter <mode>. Write operations are blocked until a mode is active.',
      })
      return
    }
  }

  outputJson({ decision: 'allow' })
}

// ── Handler: task-deps ──
// Checks task dependencies before allowing TaskUpdate to mark a task completed.
// Blocks completion if any blockedBy tasks are not yet completed.
async function handleTaskDeps(input: Record<string, unknown>): Promise<void> {
  const taskId = (input.task_id as string) ?? ''
  const newStatus = (input.status as string) ?? ''

  // Only enforce deps when completing a task
  if (!taskId || newStatus !== 'completed') {
    outputJson({ decision: 'allow' })
    return
  }

  try {
    const session = await getSessionState(input.session_id as string | undefined)
    if (!session) {
      outputJson({ decision: 'allow' })
      return
    }

    const tasks = readNativeTaskFiles(session.sessionId)
    const task = tasks.find((t) => t.id === taskId)

    if (!task || !task.blockedBy?.length) {
      outputJson({ decision: 'allow' })
      return
    }

    // Check if all blockedBy tasks are completed
    const incomplete = task.blockedBy.filter((depId) => {
      const dep = tasks.find((t) => t.id === depId)
      return dep && dep.status !== 'completed'
    })

    if (incomplete.length > 0) {
      const depTasks = incomplete
        .map((depId) => {
          const dep = tasks.find((t) => t.id === depId)
          return dep ? `[${dep.id}] ${dep.subject}` : depId
        })
        .join(', ')
      outputJson({
        decision: 'block',
        reason: `Task [${taskId}] is blocked by incomplete task(s): ${depTasks}`,
      })
      return
    }
  } catch {
    // On any error, allow — don't block on infra failures
  }

  outputJson({ decision: 'allow' })
}

// ── Handler: task-evidence ──
// Warns (via additionalContext) when completing a task with no committed changes.
// Always ALLOWs — evidence check is advisory, not blocking.
async function handleTaskEvidence(_input: Record<string, unknown>): Promise<void> {
  let additionalContext = ''

  try {
    // Run git status from the project root so hook runners spawned in a
    // subdirectory (e.g. .claude/hooks/) don't get a spuriously clean status.
    let cwd: string | undefined
    try {
      cwd = findClaudeProjectDir()
    } catch {
      // No .claude/ found — fall back to hook runner's cwd
    }
    const gitStatus = execSync('git status --porcelain 2>/dev/null || true', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(cwd ? { cwd } : {}),
    }).trim()

    if (gitStatus) {
      // There are uncommitted changes — remind agent to commit before marking done
      const changedFiles = gitStatus.split('\n').filter((l) => !l.startsWith('??'))
      if (changedFiles.length > 0) {
        additionalContext =
          `⚠️ You have ${changedFiles.length} uncommitted change(s). ` +
          'Commit your work before marking this task completed.'
      }
    }
  } catch {
    // Git unavailable — no advisory needed
  }

  outputJson({
    decision: 'allow',
    ...(additionalContext ? { reason: additionalContext } : {}),
  })
}

// ── Handler: stop-conditions ──
// Calls canExit to check if session can be stopped
async function handleStopConditions(input: Record<string, unknown>): Promise<void> {
  const session = await getSessionState(input.session_id as string | undefined)

  if (!session) {
    // No session — allow stop (no output = allow)
    return
  }

  const { state, sessionId } = session

  // Skip checks for freeform/default mode
  if (
    state.sessionType === 'freeform' ||
    state.sessionType === 'qa' ||
    state.currentMode === 'default'
  ) {
    return
  }

  // Run can-exit check, capturing output
  const { canExit } = await import('./can-exit.js')
  const origExitCode = process.exitCode
  const exitOutput = await captureConsoleLog(() => canExit(['--json', `--session=${sessionId}`]))
  process.exitCode = origExitCode

  try {
    const result = JSON.parse(exitOutput) as {
      canExit: boolean
      reasons: string[]
      guidance?: { nextStepMessage?: string; escapeHatch?: string }
    }
    if (!result.canExit) {
      const parts: string[] = ['Session has incomplete work:']
      for (const reason of result.reasons) {
        parts.push(`- ${reason}`)
      }
      if (result.guidance?.nextStepMessage) {
        parts.push(result.guidance.nextStepMessage)
      }
      if (result.guidance?.escapeHatch) {
        parts.push(result.guidance.escapeHatch)
      }
      // decision: "block" must be at the TOP LEVEL (not inside hookSpecificOutput)
      outputJson({
        decision: 'block',
        reason: parts.join('\n'),
      })
    }
    // canExit === true: output nothing (allows stop)
  } catch {
    // Could not parse exit output — allow stop
  }
}

// ── Hook name -> handler map ──
const hookHandlers: Record<string, (input: Record<string, unknown>) => Promise<void>> = {
  'session-start': handleSessionStart,
  'user-prompt': handleUserPrompt,
  'mode-gate': handleModeGate,
  'task-deps': handleTaskDeps,
  'task-evidence': handleTaskEvidence,
  'stop-conditions': handleStopConditions,
}

/**
 * Parse command line arguments for hook command
 */
function parseHookArgs(args: string[]): { hookName: string; remaining: string[] } {
  const hookName = args[0] ?? ''
  const remaining = args.slice(1)
  return { hookName, remaining }
}

/**
 * wm hook <name>
 * Dispatch hook events. Each hook reads stdin JSON and outputs Claude Code hook JSON.
 *
 * Supported hooks:
 *   session-start    - Initialize session and output context (SessionStart)
 *   user-prompt      - Detect mode from user message (UserPromptSubmit)
 *   mode-gate        - Check mode state for tool gating (PreToolUse)
 *   task-deps        - Check task dependencies (PreToolUse:TaskUpdate)
 *   task-evidence    - Check git status for task evidence (PreToolUse:TaskUpdate)
 *   stop-conditions  - Check if session can be stopped (Stop)
 */
export async function hook(args: string[]): Promise<void> {
  const { hookName } = parseHookArgs(args)

  if (!hookName) {
    process.stderr.write('Usage: wm hook <name>\n')
    process.stderr.write(`Available hooks: ${Object.keys(hookHandlers).join(', ')}\n`)
    process.exitCode = 1
    return
  }

  const handler = hookHandlers[hookName]
  if (!handler) {
    process.stderr.write(`Unknown hook: ${hookName}\n`)
    process.stderr.write(`Available hooks: ${Object.keys(hookHandlers).join(', ')}\n`)
    process.exitCode = 1
    return
  }

  // Read stdin JSON input
  const input = await readStdinJson()

  // Execute handler
  await handler(input)
}
