/**
 * Mock Hook Runner
 *
 * Execute Claude Code hooks in isolation with controlled inputs
 * and capture their outputs for testing.
 */

import { spawn } from 'node:child_process'

export type HookType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'PreCompact'
  | 'Stop'

export interface HookInput {
  /** Hook type (determines which hook script to run) */
  hookType: HookType
  /** Input data to pipe to stdin */
  stdinData: unknown
  /** Environment variables to set */
  env?: Record<string, string>
  /** Working directory (defaults to project root) */
  cwd?: string
  /** Timeout in milliseconds */
  timeout?: number
}

export interface HookResult {
  /** Exit code */
  exitCode: number
  /** Stdout content */
  stdout: string
  /** Stderr content */
  stderr: string
  /** Whether hook blocked the action (exit 1 with stderr) */
  blocked: boolean
  /** Parsed JSON from stdout if valid */
  json?: unknown
  /** Duration in milliseconds */
  duration: number
}

/**
 * Map hook types to script paths
 */
const HOOK_SCRIPTS: Record<HookType, string> = {
  PreToolUse: '.claude/hooks/pre-tool-use-session-type.sh',
  PostToolUse: '.claude/hooks/post-tool-use-tracker.sh',
  UserPromptSubmit: '.claude/hooks/user-prompt-submit.sh',
  SessionStart: '.claude/hooks/session-start.sh',
  PreCompact: '.claude/hooks/pre-compact-save-notes.sh',
  Stop: '.claude/hooks/stop-workflow-verify.sh',
}

/**
 * Run a hook with controlled input and capture output
 */
export async function runHook(input: HookInput): Promise<HookResult> {
  const scriptPath = HOOK_SCRIPTS[input.hookType]
  const cwd = input.cwd ?? process.cwd()
  const timeout = input.timeout ?? 30000

  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath], {
      cwd,
      env: {
        ...process.env,
        ...input.env,
        // Ensure hook can find dependencies
        PATH: process.env.PATH,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    // Send stdin data
    const stdinStr =
      typeof input.stdinData === 'string' ? input.stdinData : JSON.stringify(input.stdinData)
    proc.stdin.write(stdinStr)
    proc.stdin.end()

    // Handle timeout
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Hook ${input.hookType} timed out after ${timeout}ms`))
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      const duration = Date.now() - startTime

      // Parse JSON from stdout if possible
      let json: unknown
      try {
        const trimmed = stdout.trim()
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          json = JSON.parse(trimmed)
        }
      } catch {
        // Not JSON, ignore
      }

      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        blocked: code === 1 && stderr.length > 0,
        json,
        duration,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Pre-built tool input fixtures for common scenarios
 */
export const ToolInputs = {
  /** Read tool input */
  read(filePath: string): object {
    return {
      tool_name: 'Read',
      tool_input: { file_path: filePath },
    }
  },

  /** Grep tool input */
  grep(pattern: string, path?: string): object {
    return {
      tool_name: 'Grep',
      tool_input: { pattern, path },
    }
  },

  /** Glob tool input */
  glob(pattern: string, path?: string): object {
    return {
      tool_name: 'Glob',
      tool_input: { pattern, path },
    }
  },

  /** Edit tool input */
  edit(filePath: string, oldStr: string, newStr: string): object {
    return {
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: oldStr, new_string: newStr },
    }
  },

  /** Write tool input */
  write(filePath: string, content: string): object {
    return {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }
  },

  /** Bash tool input */
  bash(command: string): object {
    return {
      tool_name: 'Bash',
      tool_input: { command },
    }
  },

  /** Task tool input (agent spawning) */
  task(subagentType: string, prompt: string): object {
    return {
      tool_name: 'Task',
      tool_input: { subagent_type: subagentType, prompt },
    }
  },

  /** Skill tool input */
  skill(skillName: string, args?: string): object {
    return {
      tool_name: 'Skill',
      tool_input: { skill: skillName, args },
    }
  },

  /** TaskCreate tool input (native Claude Code tasks) */
  taskCreate(subject: string, description: string, activeForm?: string): object {
    return {
      tool_name: 'TaskCreate',
      tool_input: { subject, description, activeForm },
    }
  },

  /** TaskUpdate tool input (native Claude Code tasks) */
  taskUpdate(taskId: string, status?: 'pending' | 'in_progress' | 'completed'): object {
    return {
      tool_name: 'TaskUpdate',
      tool_input: { taskId, status },
    }
  },

  /** TaskList tool input (native Claude Code tasks) */
  taskList(): object {
    return {
      tool_name: 'TaskList',
      tool_input: {},
    }
  },

  /** AskUserQuestion tool input */
  askUserQuestion(questions: Array<{ question: string; header: string }>): object {
    return {
      tool_name: 'AskUserQuestion',
      tool_input: { questions },
    }
  },
}

/**
 * Mock user prompt inputs
 */
export const UserPromptInputs = {
  /** User wants to implement something */
  implementRequest(description: string): string {
    return `implement ${description}`
  },

  /** User wants to plan something */
  planRequest(description: string): string {
    return `plan ${description}`
  },

  /** User wants to debug something */
  debugRequest(description: string): string {
    return `debug ${description}`
  },

  /** User wants to research something */
  researchRequest(description: string): string {
    return `research ${description}`
  },

  /** Generic task request */
  taskRequest(description: string): string {
    return description
  },
}
