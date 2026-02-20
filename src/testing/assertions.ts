/**
 * Test Assertions for Hook and Session Testing
 *
 * Provides fluent assertions for verifying hook behavior,
 * session state transitions, and workflow conditions.
 */

import type { HookResult } from './mock-hooks'
import type { SessionState } from '../state/schema'

/**
 * Assert that a hook blocked the tool call
 */
export function assertBlocked(result: HookResult, expectedReason?: string): void {
  if (!result.blocked) {
    throw new AssertionError(
      `Expected hook to BLOCK but it ALLOWED (exit code: ${result.exitCode})`,
      { actual: result, expected: 'blocked=true' },
    )
  }

  if (result.exitCode !== 1) {
    throw new AssertionError(`Expected exit code 1 for blocked hook, got ${result.exitCode}`, {
      actual: result.exitCode,
      expected: 1,
    })
  }

  if (expectedReason && !result.stderr.includes(expectedReason)) {
    throw new AssertionError(`Expected stderr to contain "${expectedReason}"`, {
      actual: result.stderr,
      expected: expectedReason,
    })
  }
}

/**
 * Assert that a hook allowed the tool call
 */
export function assertAllowed(result: HookResult): void {
  if (result.blocked) {
    throw new AssertionError(`Expected hook to ALLOW but it BLOCKED: ${result.stderr}`, {
      actual: result,
      expected: 'blocked=false',
    })
  }

  if (result.exitCode !== 0) {
    throw new AssertionError(`Expected exit code 0 for allowed hook, got ${result.exitCode}`, {
      actual: result.exitCode,
      expected: 0,
    })
  }
}

/**
 * Assert session is in expected mode
 */
export function assertMode(state: SessionState, expectedMode: string | null): void {
  if (state.currentMode !== expectedMode) {
    throw new AssertionError(`Expected mode "${expectedMode}", got "${state.currentMode}"`, {
      actual: state.currentMode,
      expected: expectedMode,
    })
  }
}

/**
 * Assert session type matches
 */
export function assertSessionType(state: SessionState, expectedType: string): void {
  if (state.sessionType !== expectedType) {
    throw new AssertionError(`Expected sessionType "${expectedType}", got "${state.sessionType}"`, {
      actual: state.sessionType,
      expected: expectedType,
    })
  }
}

/**
 * Assert todos have been written
 */
export function assertTodosWritten(state: SessionState, expected = true): void {
  if (state.todosWritten !== expected) {
    throw new AssertionError(`Expected todosWritten=${expected}, got ${state.todosWritten}`, {
      actual: state.todosWritten,
      expected,
    })
  }
}

/**
 * Assert phase is in mode history
 */
export function assertPhaseInHistory(state: SessionState, mode: string): void {
  const found = state.modeHistory.some((entry) => {
    // modeHistory can be either string or { mode, enteredAt } object
    if (typeof entry === 'string') {
      return entry === mode
    }
    return entry.mode === mode
  })
  if (!found) {
    throw new AssertionError(`Expected mode "${mode}" in history, but not found`, {
      actual: state.modeHistory,
      expected: mode,
    })
  }
}

/**
 * Assert workflow ID format
 */
export function assertWorkflowId(state: SessionState, pattern: RegExp): void {
  if (!state.workflowId) {
    throw new AssertionError('Expected workflowId to be set, but it is null', {
      actual: null,
      expected: pattern.toString(),
    })
  }

  if (!pattern.test(state.workflowId)) {
    throw new AssertionError(`Expected workflowId to match ${pattern}, got "${state.workflowId}"`, {
      actual: state.workflowId,
      expected: pattern.toString(),
    })
  }
}

/**
 * Assert linked issue
 */
export function assertLinkedIssue(state: SessionState, expectedIssueNumber: number): void {
  if (!state.issueNumber) {
    throw new AssertionError(
      `Expected issue #${expectedIssueNumber} to be linked, but no issue linked`,
      { actual: null, expected: expectedIssueNumber },
    )
  }

  if (state.issueNumber !== expectedIssueNumber) {
    throw new AssertionError(`Expected issue #${expectedIssueNumber}, got #${state.issueNumber}`, {
      actual: state.issueNumber,
      expected: expectedIssueNumber,
    })
  }
}

/**
 * Assert hook completed within time limit
 */
export function assertDuration(result: HookResult, maxMs: number): void {
  if (result.duration > maxMs) {
    throw new AssertionError(`Hook took ${result.duration}ms, expected < ${maxMs}ms`, {
      actual: result.duration,
      expected: `< ${maxMs}`,
    })
  }
}

/**
 * Assert hook returned valid JSON
 */
export function assertJsonOutput(result: HookResult): unknown {
  if (result.json === undefined) {
    throw new AssertionError('Expected hook to return JSON output, but got none', {
      actual: result.stdout,
      expected: 'valid JSON',
    })
  }
  return result.json
}

/**
 * Assert hook returned specific JSON structure
 */
export function assertJsonContains(result: HookResult, expected: Record<string, unknown>): void {
  const json = assertJsonOutput(result) as Record<string, unknown>

  for (const [key, value] of Object.entries(expected)) {
    if (json[key] !== value) {
      throw new AssertionError(
        `Expected JSON.${key} = ${JSON.stringify(value)}, got ${JSON.stringify(json[key])}`,
        { actual: json[key], expected: value },
      )
    }
  }
}

/**
 * Custom assertion error with context
 */
export class AssertionError extends Error {
  actual: unknown
  expected: unknown

  constructor(message: string, context: { actual: unknown; expected: unknown }) {
    super(message)
    this.name = 'AssertionError'
    this.actual = context.actual
    this.expected = context.expected
  }
}

/**
 * Fluent assertion builder for hook results
 */
export class HookResultAssertion {
  constructor(private result: HookResult) {}

  isBlocked(reason?: string): this {
    assertBlocked(this.result, reason)
    return this
  }

  isAllowed(): this {
    assertAllowed(this.result)
    return this
  }

  completedIn(maxMs: number): this {
    assertDuration(this.result, maxMs)
    return this
  }

  hasJson(): this {
    assertJsonOutput(this.result)
    return this
  }

  jsonContains(expected: Record<string, unknown>): this {
    assertJsonContains(this.result, expected)
    return this
  }

  stderrContains(text: string): this {
    if (!this.result.stderr.includes(text)) {
      throw new AssertionError(`Expected stderr to contain "${text}"`, {
        actual: this.result.stderr,
        expected: text,
      })
    }
    return this
  }

  stdoutContains(text: string): this {
    if (!this.result.stdout.includes(text)) {
      throw new AssertionError(`Expected stdout to contain "${text}"`, {
        actual: this.result.stdout,
        expected: text,
      })
    }
    return this
  }
}

/**
 * Fluent assertion builder for session state
 */
export class SessionStateAssertion {
  constructor(private state: SessionState) {}

  hasMode(mode: string | null): this {
    assertMode(this.state, mode)
    return this
  }

  hasSessionType(type: string): this {
    assertSessionType(this.state, type)
    return this
  }

  hasTodosWritten(written = true): this {
    assertTodosWritten(this.state, written)
    return this
  }

  hasPhaseInHistory(mode: string): this {
    assertPhaseInHistory(this.state, mode)
    return this
  }

  hasWorkflowId(pattern: RegExp): this {
    assertWorkflowId(this.state, pattern)
    return this
  }

  hasLinkedIssue(issueNumber: number): this {
    assertLinkedIssue(this.state, issueNumber)
    return this
  }
}

/**
 * Type guard for HookResult
 */
function isHookResult(value: HookResult | SessionState): value is HookResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'exitCode' in value &&
    'stdout' in value &&
    'stderr' in value &&
    'blocked' in value &&
    'duration' in value
  )
}

/**
 * Entry point for fluent assertions
 */
export function assertThat(result: HookResult): HookResultAssertion
export function assertThat(state: SessionState): SessionStateAssertion
export function assertThat(
  value: HookResult | SessionState,
): HookResultAssertion | SessionStateAssertion {
  if (isHookResult(value)) {
    return new HookResultAssertion(value)
  }
  return new SessionStateAssertion(value as SessionState)
}
