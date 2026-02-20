/**
 * Test Fixtures for Hook and Session Testing
 *
 * Pre-built test scenarios that combine session state,
 * hook inputs, and expected outcomes.
 */

import type { HookInput } from './mock-hooks'
import type { MockSessionOptions } from './mock-session'
import { SessionFixtures } from './mock-session'
import { ToolInputs, UserPromptInputs } from './mock-hooks'

/**
 * Complete test scenario including session setup and expected behavior
 */
export interface TestScenario {
  /** Human-readable description */
  name: string
  /** Session configuration */
  session: MockSessionOptions
  /** Hook input to test */
  hookInput: HookInput
  /** Expected outcome */
  expected: {
    blocked: boolean
    stderrContains?: string[]
    exitCode?: number
  }
}

/**
 * Pre-built scenarios for PreToolUse mode enforcement
 */
export const ModeEnforcementScenarios: TestScenario[] = [
  {
    name: 'Block Read tool when no mode active',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.read('/path/to/file.ts'),
    },
    expected: {
      blocked: true,
      stderrContains: ['MODE REQUIRED', 'enter a mode'],
    },
  },
  {
    name: 'Block Grep tool when no mode active',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.grep('pattern', 'apps/'),
    },
    expected: {
      blocked: true,
      stderrContains: ['MODE REQUIRED'],
    },
  },
  {
    name: 'Block Task tool when no mode active',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.task('Explore', 'search codebase'),
    },
    expected: {
      blocked: true,
      stderrContains: ['MODE REQUIRED'],
    },
  },
  {
    name: 'Allow Skill tool without mode (needed to enter mode)',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: { tool_name: 'Skill', tool_input: { skill: 'mode', args: 'planning' } },
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
  {
    name: 'Allow TaskCreate tool without mode',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.taskCreate('Task 1', 'Task description', 'Working on task 1'),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
  {
    name: 'Allow AskUserQuestion tool without mode',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.askUserQuestion([{ question: 'Which approach?', header: 'Approach' }]),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
  {
    name: 'Allow Read tool when mode is active',
    session: { initialState: SessionFixtures.planningMode() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.read('/path/to/file.ts'),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
]

/**
 * Pre-built scenarios for native tasks gate enforcement
 * (Tasks are auto-created on mode entry via `wm enter`)
 */
export const NativeTasksGateScenarios: TestScenario[] = [
  {
    name: 'Allow Read tool when mode active (tasks auto-created)',
    session: {
      initialState: SessionFixtures.planningMode(),
    },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.read('/path/to/file.ts'),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
  {
    name: 'Allow Skill tool in any mode',
    session: {
      initialState: SessionFixtures.planningMode(),
    },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: { tool_name: 'Skill', tool_input: { skill: 'mode', args: 'planning' } },
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
  {
    name: 'Allow TaskList tool in any mode',
    session: {
      initialState: SessionFixtures.planningMode(),
    },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.taskList(),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
]

/**
 * Pre-built scenarios for file writing tool enforcement
 */
export const FileWritingScenarios: TestScenario[] = [
  {
    name: 'Block Edit tool when no mode active',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.edit('/path/file.ts', 'old', 'new'),
    },
    expected: {
      blocked: true,
      stderrContains: ['MODE REQUIRED'],
    },
  },
  {
    name: 'Block Write tool when no mode active',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.write('/path/file.ts', 'content'),
    },
    expected: {
      blocked: true,
      stderrContains: ['MODE REQUIRED'],
    },
  },
  {
    name: 'Allow Edit tool when mode active (tasks auto-created)',
    session: {
      initialState: SessionFixtures.implementationMode(),
    },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.edit('/path/file.ts', 'old', 'new'),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
]

/**
 * Pre-built scenarios for bead close evidence requirement
 */
export const BeadCloseScenarios: TestScenario[] = [
  {
    name: 'Block bd close without --reason flag',
    session: { initialState: SessionFixtures.implementationMode() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.bash('bd close beads-abc123'),
    },
    expected: {
      blocked: true,
      stderrContains: ['--reason', 'evidence'],
    },
  },
  {
    name: 'Allow bd close with --reason flag',
    session: { initialState: SessionFixtures.implementationMode() },
    hookInput: {
      hookType: 'PreToolUse',
      stdinData: ToolInputs.bash('bd close beads-abc123 --reason="Implemented: commit abc123"'),
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
]

/**
 * Pre-built scenarios for stop hook enforcement
 */
export const StopHookScenarios: TestScenario[] = [
  {
    name: 'Block stop when phase beads not closed',
    session: {
      initialState: {
        ...SessionFixtures.planningMode(),
        modeState: {
          planning: { status: 'active', currentPhase: 'p0' },
        },
      },
    },
    hookInput: {
      hookType: 'Stop',
      stdinData: {},
    },
    expected: {
      blocked: true,
      stderrContains: ['phase', 'not complete'],
    },
  },
  {
    name: 'Block stop when changes not committed',
    session: {
      initialState: {
        ...SessionFixtures.completedWorkflow(),
        // git status shows uncommitted changes
      },
    },
    hookInput: {
      hookType: 'Stop',
      stdinData: {},
      env: { GIT_STATUS: 'modified: file.ts' },
    },
    expected: {
      blocked: true,
      stderrContains: ['commit', 'uncommitted'],
    },
  },
  {
    name: 'Allow stop when all conditions met',
    session: {
      initialState: SessionFixtures.completedWorkflow(),
    },
    hookInput: {
      hookType: 'Stop',
      stdinData: {},
      env: { GIT_STATUS: 'nothing to commit, working tree clean' },
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
]

/**
 * Pre-built scenarios for UserPromptSubmit hook
 */
export const UserPromptSubmitScenarios: TestScenario[] = [
  {
    name: 'Detect planning intent and suggest mode',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'UserPromptSubmit',
      stdinData: UserPromptInputs.planRequest('feature #123'),
    },
    expected: {
      blocked: false,
      stderrContains: ['wm enter planning'],
    },
  },
  {
    name: 'Detect implementation intent and suggest mode',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'UserPromptSubmit',
      stdinData: UserPromptInputs.implementRequest('the auth feature'),
    },
    expected: {
      blocked: false,
      stderrContains: ['wm enter implementation'],
    },
  },
  {
    name: 'Detect debug intent and suggest mode',
    session: { initialState: SessionFixtures.fresh() },
    hookInput: {
      hookType: 'UserPromptSubmit',
      stdinData: UserPromptInputs.debugRequest('login failure'),
    },
    expected: {
      blocked: false,
      stderrContains: ['wm enter debug'],
    },
  },
]

/**
 * Pre-built scenarios for PostToolUse hook
 */
export const PostToolUseScenarios: TestScenario[] = [
  {
    name: 'Track TaskCreate call in session state',
    session: { initialState: SessionFixtures.planningMode() },
    hookInput: {
      hookType: 'PostToolUse',
      stdinData: {
        tool_name: 'TaskCreate',
        tool_input: {
          subject: 'Task 1',
          description: 'Task description',
          activeForm: 'Working on task 1',
        },
        tool_result: 'Task created',
      },
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
  {
    name: 'Track tool error in session ledger',
    session: { initialState: SessionFixtures.planningMode() },
    hookInput: {
      hookType: 'PostToolUse',
      stdinData: {
        tool_name: 'Bash',
        tool_input: { command: 'wm status' },
        tool_error: 'Error: Task not found',
      },
    },
    expected: {
      blocked: false,
      exitCode: 0,
    },
  },
]

/**
 * Run all scenarios in a test suite
 */
export function getAllScenarios(): TestScenario[] {
  return [
    ...ModeEnforcementScenarios,
    ...NativeTasksGateScenarios,
    ...FileWritingScenarios,
    ...BeadCloseScenarios,
    ...StopHookScenarios,
    ...UserPromptSubmitScenarios,
    ...PostToolUseScenarios,
  ]
}

/**
 * Get scenarios by hook type
 */
export function getScenariosByHook(hookType: string): TestScenario[] {
  return getAllScenarios().filter((s) => s.hookInput.hookType === hookType)
}

/**
 * Get scenarios that should block
 */
export function getBlockingScenarios(): TestScenario[] {
  return getAllScenarios().filter((s) => s.expected.blocked)
}

/**
 * Get scenarios that should allow
 */
export function getAllowingScenarios(): TestScenario[] {
  return getAllScenarios().filter((s) => !s.expected.blocked)
}
