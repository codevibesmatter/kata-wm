// wm hook <name> - Hook event dispatch
// Core of hooks-as-commands architecture: each hook event has a handler function
// that reads stdin JSON, performs the check, and outputs Claude Code hook JSON.
import { execSync } from 'node:child_process'
import { getStateFilePath, findClaudeProjectDir } from '../session/lookup.js'
import { readState, stateExists } from '../state/reader.js'
import { readNativeTaskFiles } from './enter/task-factory.js'
import type { SessionState } from '../state/schema.js'

/**
 * Claude Code hook output format
 *
 * PreToolUse: use hookSpecificOutput.permissionDecision (top-level decision is deprecated for this event)
 * Stop/PostToolUse/UserPromptSubmit: use top-level decision: "block"
 * Context hooks (SessionStart, UserPromptSubmit): use hookSpecificOutput.additionalContext
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
        // PreToolUse-specific fields
        permissionDecision?: 'allow' | 'deny' | 'ask'
        permissionDecisionReason?: string
        updatedInput?: Record<string, unknown>
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

  // Import and run init (silently capture its output)
  const { init } = await import('./init.js')
  const initArgs: string[] = []
  if (sessionId) initArgs.push(`--session=${sessionId}`)
  await captureConsoleLog(() => init(initArgs))

  // Delegate to prime for the full kata hints context
  const { prime } = await import('./prime.js')
  const primeArgs: string[] = []
  if (sessionId) primeArgs.push(`--session=${sessionId}`)
  const additionalContext = await captureConsoleLog(() => prime(primeArgs))

  outputJson({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
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
// Checks mode state for PreToolUse gating, and injects KATA_SESSION_ID
// into kata bash commands so they can resolve the session ID.
async function handleModeGate(input: Record<string, unknown>): Promise<void> {
  const sessionId = input.session_id as string | undefined
  const toolName = (input.tool_name as string) ?? ''
  const toolInput = (input.tool_input as Record<string, unknown>) ?? {}

  const session = await getSessionState(sessionId)

  if (session) {
    const { state } = session

    // If in default mode (no mode entered), block write operations.
    // These are Claude Code's internal tool_name values for file-mutation operations.
    if (state.currentMode === 'default' || !state.currentMode) {
      const writeTools = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
      if (writeTools.includes(toolName)) {
        outputJson({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'Enter a mode first: wm enter <mode>. Write operations are blocked until a mode is active.',
          },
        })
        return
      }
    }
  }

  // Inject --session=<id> into kata bash commands so they can resolve the session.
  // Uses updatedInput to append --session=<id> to the kata subcommand call.
  if (toolName === 'Bash' && sessionId) {
    const command = (toolInput.command as string) ?? ''
    // Match `kata` as a top-level command: at start, or after ;/&&/||/|
    // Avoids false-positives on kata appearing inside string literals
    const kataAsCommand = /(?:^|[;&|]\s*)((?:\.\/|(?:\/\S+\/)*)kata)\s/.exec(command)
    if (kataAsCommand && !command.includes('--session=') && !/\bkata\s+hook\b/.test(command)) {
      // Append --session=<id> after the first kata subcommand invocation
      const injected = command.replace(
        /(\bkata\s+\S+)/,
        `$1 --session=${sessionId}`,
      )
      outputJson({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: {
            ...toolInput,
            command: injected,
          },
        },
      })
      return
    }
  }

  // Default: allow (no JSON output needed, but be explicit)
  outputJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  })
}

// ── Handler: task-deps ──
// Checks task dependencies before allowing TaskUpdate to mark a task completed.
// Blocks completion if any blockedBy tasks are not yet completed.
async function handleTaskDeps(input: Record<string, unknown>): Promise<void> {
  // Task fields arrive inside tool_input for PreToolUse hooks
  const toolInput = (input.tool_input as Record<string, unknown>) ?? {}
  const taskId = (toolInput.taskId as string) ?? ''
  const newStatus = (toolInput.status as string) ?? ''

  // Only enforce deps when completing a task
  if (!taskId || newStatus !== 'completed') {
    outputJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
    return
  }

  try {
    const session = await getSessionState(input.session_id as string | undefined)
    if (!session) {
      outputJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
      return
    }

    const tasks = readNativeTaskFiles(session.sessionId)
    const task = tasks.find((t) => t.id === taskId)

    if (!task || !task.blockedBy?.length) {
      outputJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
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
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Task [${taskId}] is blocked by incomplete task(s): ${depTasks}`,
        },
      })
      return
    }
  } catch {
    // On any error, allow — don't block on infra failures
  }

  outputJson({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
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
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      ...(additionalContext ? { additionalContext } : {}),
    },
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
