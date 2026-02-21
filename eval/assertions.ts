/**
 * Eval-specific assertions for kata-wm agentic evals.
 *
 * These extend the unit-test assertions in src/testing/assertions.ts with
 * assertions that require a real project directory and git history.
 */

import type { EvalCheckpoint, EvalContext } from './harness.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(): string | null {
  return null
}

function fail(msg: string): string {
  return msg
}

// ─── Session State Assertions ──────────────────────────────────────────────────

/**
 * Assert that the session is in the given mode.
 */
export function assertCurrentMode(mode: string): EvalCheckpoint {
  return {
    name: `session.currentMode === '${mode}'`,
    assert(ctx: EvalContext) {
      const state = ctx.getSessionState()
      if (!state) return fail('Session state not found')
      if (state.currentMode !== mode) {
        return fail(`Expected currentMode '${mode}', got '${state.currentMode ?? 'undefined'}'`)
      }
      return pass()
    },
  }
}

/**
 * Assert that the session type matches.
 */
export function assertSessionType(sessionType: string): EvalCheckpoint {
  return {
    name: `session.sessionType === '${sessionType}'`,
    assert(ctx: EvalContext) {
      const state = ctx.getSessionState()
      if (!state) return fail('Session state not found')
      if (state.sessionType !== sessionType) {
        return fail(`Expected sessionType '${sessionType}', got '${state.sessionType ?? 'undefined'}'`)
      }
      return pass()
    },
  }
}

// ─── Git Assertions ────────────────────────────────────────────────────────────

/**
 * Assert that at least one new commit was made beyond the initial fixture commit.
 */
export function assertNewCommit(): EvalCheckpoint {
  return {
    name: 'git: new commit created',
    assert(ctx: EvalContext) {
      const log = ctx.run('git log --oneline')
      const lines = log.split('\n').filter(Boolean)
      if (lines.length < 2) {
        return fail(`Expected at least 2 commits (fixture + new), found ${lines.length}`)
      }
      return pass()
    },
  }
}

/**
 * Assert that the working tree is clean (all changes committed).
 */
export function assertCleanWorkingTree(): EvalCheckpoint {
  return {
    name: 'git: working tree is clean',
    assert(ctx: EvalContext) {
      const status = ctx.run('git status --porcelain')
      const dirty = status.split('\n').filter((l) => l && !l.startsWith('??'))
      if (dirty.length > 0) {
        return fail(`Uncommitted tracked changes: ${dirty.slice(0, 3).join(', ')}`)
      }
      return pass()
    },
  }
}

/**
 * Assert that the diff vs initial commit contains a pattern.
 */
export function assertDiffContains(pattern: string | RegExp): EvalCheckpoint {
  const label = pattern instanceof RegExp ? pattern.source : pattern
  return {
    name: `git diff contains: ${label}`,
    assert(ctx: EvalContext) {
      const diff = ctx.run('git diff HEAD~1..HEAD')
      const matches = pattern instanceof RegExp ? pattern.test(diff) : diff.includes(pattern)
      if (!matches) {
        return fail(`Expected diff to contain '${label}'`)
      }
      return pass()
    },
  }
}

// ─── File Assertions ───────────────────────────────────────────────────────────

/**
 * Assert that a file exists relative to the project dir.
 */
export function assertFileExists(relativePath: string): EvalCheckpoint {
  return {
    name: `file exists: ${relativePath}`,
    assert(ctx: EvalContext) {
      if (!ctx.fileExists(relativePath)) {
        return fail(`Expected file to exist: ${relativePath}`)
      }
      return pass()
    },
  }
}

/**
 * Assert that a file contains a string or matches a pattern.
 */
export function assertFileContains(relativePath: string, pattern: string | RegExp): EvalCheckpoint {
  const label = pattern instanceof RegExp ? pattern.source : pattern
  return {
    name: `${relativePath} contains: ${label}`,
    assert(ctx: EvalContext) {
      if (!ctx.fileExists(relativePath)) {
        return fail(`File not found: ${relativePath}`)
      }
      const content = ctx.readFile(relativePath)
      const matches = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
      if (!matches) {
        return fail(`Expected '${relativePath}' to contain '${label}'`)
      }
      return pass()
    },
  }
}

// ─── kata can-exit Assertion ───────────────────────────────────────────────────

/**
 * Assert that kata can-exit returns 0 (all tasks complete, conditions met).
 */
export function assertCanExit(): EvalCheckpoint {
  return {
    name: 'kata can-exit: exits 0',
    assert(ctx: EvalContext) {
      const output = ctx.run('kata can-exit 2>&1; echo "EXIT:$?"')
      if (!output.includes('EXIT:0')) {
        return fail(`kata can-exit did not exit 0. Output: ${output.slice(0, 200)}`)
      }
      return pass()
    },
  }
}
