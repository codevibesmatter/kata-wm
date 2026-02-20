/**
 * Testing Utilities for Workflow Management
 *
 * Provides mock systems for testing hooks, session state,
 * and workflow transitions in isolation.
 *
 * @example
 * ```typescript
 * import {
 *   createMockSession,
 *   SessionFixtures,
 *   runHook,
 *   ToolInputs,
 *   assertThat,
 *   ModeEnforcementScenarios,
 * } from '@baseplane/workflow-management/testing'
 *
 * // Create isolated test session
 * const session = await createMockSession({
 *   initialState: SessionFixtures.planningMode()
 * })
 *
 * // Run a hook with mock input
 * const result = await runHook({
 *   hookType: 'PreToolUse',
 *   stdinData: ToolInputs.read('/path/to/file.ts'),
 *   cwd: session.sessionDir,
 * })
 *
 * // Assert expected behavior
 * assertThat(result).isAllowed().completedIn(1000)
 *
 * // Cleanup
 * await session.cleanup()
 * ```
 */

// Mock session state management
export {
  createMockSession,
  SessionFixtures,
  type MockSession,
  type MockSessionOptions,
} from './mock-session'

// Mock hook execution
export {
  runHook,
  ToolInputs,
  UserPromptInputs,
  type HookType,
  type HookInput,
  type HookResult,
} from './mock-hooks'

// Test assertions
export {
  assertThat,
  assertBlocked,
  assertAllowed,
  assertMode,
  assertSessionType,
  assertTodosWritten,
  assertPhaseInHistory,
  assertWorkflowId,
  assertLinkedIssue,
  assertDuration,
  assertJsonOutput,
  assertJsonContains,
  AssertionError,
  HookResultAssertion,
  SessionStateAssertion,
} from './assertions'

// Pre-built test scenarios
export {
  ModeEnforcementScenarios,
  NativeTasksGateScenarios,
  FileWritingScenarios,
  BeadCloseScenarios,
  StopHookScenarios,
  UserPromptSubmitScenarios,
  PostToolUseScenarios,
  getAllScenarios,
  getScenariosByHook,
  getBlockingScenarios,
  getAllowingScenarios,
  type TestScenario,
} from './test-fixtures'
