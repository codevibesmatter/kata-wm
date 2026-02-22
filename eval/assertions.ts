/**
 * Eval-specific assertions for kata-wm agentic evals.
 *
 * All eval assertions live here. Scenarios import what they need —
 * individual assertions or preset arrays. No inline assertion
 * definitions in scenario files.
 */

import type { EvalCheckpoint, EvalContext } from './harness.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(): string | null {
  return null
}

function fail(msg: string): string {
  return msg
}

/**
 * Read a top-level key from .claude/workflows/wm.yaml via grep.
 * Returns the value string or the provided default.
 */
function readWmYamlKey(ctx: EvalContext, key: string, fallback: string): string {
  const raw = ctx.run(
    `grep '^${key}:' .claude/workflows/wm.yaml 2>/dev/null | awk '{print $2}'`,
  )?.trim()
  return raw || fallback
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

/**
 * Assert that the agent stayed in the given mode (no unexpected mode switches).
 */
export function assertStayedInMode(mode: string): EvalCheckpoint {
  return {
    name: `agent stayed in ${mode} mode`,
    assert(ctx: EvalContext) {
      const state = ctx.getSessionState()
      if (!state) return fail('Session state not found')
      const history: Array<{ mode: string }> = state.modeHistory ?? []
      const otherModes = history
        .map((h) => h.mode)
        .filter((m) => m !== mode && m !== 'default')
      if (otherModes.length > 0) {
        return fail(`Agent switched to other modes: ${otherModes.join(', ')}`)
      }
      return pass()
    },
  }
}

/**
 * Assert that a given mode appears in session history.
 */
export function assertModeInHistory(mode: string): EvalCheckpoint {
  return {
    name: `${mode} mode in session history`,
    assert(ctx: EvalContext) {
      const state = ctx.getSessionState()
      if (!state) return fail('Session state not found')
      const hasMode = state.modeHistory?.some((h) => h.mode === mode)
      if (!hasMode) {
        return fail(`${mode} mode not found in history: ${JSON.stringify(state.modeHistory)}`)
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
      // Diff against the initial fixture commit (root commit) so all agent
      // changes are visible regardless of how many commits were made.
      const initialSha = ctx.run('git rev-list --max-parents=0 HEAD')
      const diff = ctx.run(`git diff ${initialSha}..HEAD`)
      const matches = pattern instanceof RegExp ? pattern.test(diff) : diff.includes(pattern)
      if (!matches) {
        return fail(`Expected diff to contain '${label}'`)
      }
      return pass()
    },
  }
}

/**
 * Assert that the diff vs initial commit exceeds a minimum number of lines.
 * Used for implementation scenarios to verify substantive work.
 */
export function assertDiffNonTrivial(minLines: number): EvalCheckpoint {
  return {
    name: `git diff is non-trivial (>= ${minLines} lines)`,
    assert(ctx: EvalContext) {
      const initialSha = ctx.run('git rev-list --max-parents=0 HEAD')
      const diff = ctx.run(`git diff ${initialSha}..HEAD`)
      const lines = diff.split('\n').filter(Boolean).length
      if (lines < minLines) {
        return fail(`Expected diff >= ${minLines} lines, got ${lines}`)
      }
      return pass()
    },
  }
}

/**
 * Assert that all changes have been pushed to the remote.
 */
export function assertChangesPushed(): EvalCheckpoint {
  return {
    name: 'git: changes pushed to remote',
    assert(ctx: EvalContext) {
      const status = ctx.run('git status -sb')
      if (status.includes('ahead')) {
        return fail(`Unpushed commits: ${status.split('\n')[0]}`)
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

// ─── Artifact Assertions (config-driven) ─────────────────────────────────────

/**
 * Assert that at least one spec file (.md) exists in the configured spec_path.
 * Reads spec_path from wm.yaml, falls back to 'planning/specs'.
 */
export function assertSpecFileCreated(): EvalCheckpoint {
  return {
    name: 'spec file created',
    assert(ctx: EvalContext) {
      const specPath = readWmYamlKey(ctx, 'spec_path', 'planning/specs')
      const files = ctx.listDir(specPath)
      const specFiles = files.filter((f) => f.endsWith('.md'))
      if (specFiles.length === 0) {
        return fail(`No spec files found in ${specPath}/`)
      }
      return pass()
    },
  }
}

/**
 * Assert that at least one spec file has status: approved in its frontmatter.
 */
export function assertSpecApproved(): EvalCheckpoint {
  return {
    name: 'spec frontmatter: status: approved',
    assert(ctx: EvalContext) {
      const specPath = readWmYamlKey(ctx, 'spec_path', 'planning/specs')
      const files = ctx.listDir(specPath)
      const specFiles = files.filter((f) => f.endsWith('.md'))
      if (specFiles.length === 0) return fail('No spec files to check')

      for (const file of specFiles) {
        const content = ctx.readFile(`${specPath}/${file}`)
        if (content.includes('status: approved')) return pass()
      }
      return fail('No spec file with status: approved found')
    },
  }
}

/**
 * Assert that at least one spec file contains behavior sections (### B1:, ### B2:, etc.).
 */
export function assertSpecHasBehaviors(): EvalCheckpoint {
  return {
    name: 'spec contains behavior sections',
    assert(ctx: EvalContext) {
      const specPath = readWmYamlKey(ctx, 'spec_path', 'planning/specs')
      const files = ctx.listDir(specPath)
      const specFiles = files.filter((f) => f.endsWith('.md'))
      if (specFiles.length === 0) return fail('No spec files to check')

      for (const file of specFiles) {
        const content = ctx.readFile(`${specPath}/${file}`)
        if (/###\s+B\d+:/m.test(content)) return pass()
      }
      return fail('No behavior sections (### B1:) found in spec')
    },
  }
}

/**
 * Assert that at least one research doc (.md) exists in the configured research_path.
 * Reads research_path from wm.yaml, falls back to 'planning/research'.
 */
export function assertResearchDocCreated(): EvalCheckpoint {
  return {
    name: 'research document created',
    assert(ctx: EvalContext) {
      const researchPath = readWmYamlKey(ctx, 'research_path', 'planning/research')
      const docs = ctx.run(
        `find ${researchPath} -name "*.md" -type f 2>/dev/null | head -5`,
      )
      if (!docs || docs.trim().length === 0) {
        return fail(`No research doc found in ${researchPath}/`)
      }
      return pass()
    },
  }
}

/**
 * Assert that no .md files exist at a given path (e.g., no specs created during research).
 */
export function assertNoArtifacts(dirPath: string): EvalCheckpoint {
  return {
    name: `no artifacts in ${dirPath}`,
    assert(ctx: EvalContext) {
      const files = ctx.run(
        `find ${dirPath} -name "*.md" -type f 2>/dev/null | head -5`,
      )
      if (files && files.trim().length > 0) {
        return fail(`Unexpected artifacts in ${dirPath}: ${files.trim()}`)
      }
      return pass()
    },
  }
}

// ─── Onboard Assertions ──────────────────────────────────────────────────────

/**
 * Assert that .claude/settings.json exists and has hooks configured.
 */
export function assertSettingsExist(): EvalCheckpoint {
  return {
    name: '.claude/settings.json exists with hooks',
    assert(ctx: EvalContext) {
      if (!ctx.fileExists('.claude/settings.json')) {
        return fail('.claude/settings.json not found')
      }
      const content = ctx.readFile('.claude/settings.json')
      try {
        const settings = JSON.parse(content)
        if (!settings.hooks) {
          return fail('settings.json has no hooks key')
        }
        if (!settings.hooks.SessionStart) {
          return fail('settings.json missing SessionStart hook')
        }
        return pass()
      } catch {
        return fail('settings.json is not valid JSON')
      }
    },
  }
}

/**
 * Assert that .claude/workflows/wm.yaml exists with a project: key.
 */
export function assertWmYamlExists(): EvalCheckpoint {
  return {
    name: '.claude/workflows/wm.yaml exists',
    assert(ctx: EvalContext) {
      if (!ctx.fileExists('.claude/workflows/wm.yaml')) {
        return fail('.claude/workflows/wm.yaml not found')
      }
      const content = ctx.readFile('.claude/workflows/wm.yaml')
      if (!content.includes('project:')) {
        return fail('wm.yaml missing project: key')
      }
      return pass()
    },
  }
}

/**
 * Assert that mode templates have been seeded in .claude/workflows/templates/.
 */
export function assertTemplatesExist(): EvalCheckpoint {
  return {
    name: 'mode templates seeded',
    assert(ctx: EvalContext) {
      const templates = ctx.listDir('.claude/workflows/templates')
      if (templates.length === 0) {
        return fail('No templates found in .claude/workflows/templates/')
      }
      if (!templates.includes('onboard.md')) {
        return fail('onboard.md template missing')
      }
      return pass()
    },
  }
}

/**
 * Assert that the project is a git repository.
 */
export function assertGitInitialized(): EvalCheckpoint {
  return {
    name: 'git repository initialized',
    assert(ctx: EvalContext) {
      const result = ctx.run('git rev-parse --git-dir 2>/dev/null')
      if (!result) {
        return fail('Not a git repository')
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

// ─── Presets ──────────────────────────────────────────────────────────────────

/**
 * Standard workflow presets: correct mode, committed, clean tree, can-exit.
 */
export function workflowPresets(mode: string): EvalCheckpoint[] {
  return [
    assertCurrentMode(mode),
    assertNewCommit(),
    assertCleanWorkingTree(),
    assertCanExit(),
  ]
}

/**
 * Workflow presets that also require changes pushed to remote.
 */
export function workflowPresetsWithPush(mode: string): EvalCheckpoint[] {
  return [
    ...workflowPresets(mode),
    assertChangesPushed(),
  ]
}

/**
 * Planning mode presets: workflow + spec created/approved/has behaviors.
 */
export function planningPresets(mode: string = 'planning'): EvalCheckpoint[] {
  return [
    ...workflowPresetsWithPush(mode),
    assertSpecFileCreated(),
    assertSpecApproved(),
    assertSpecHasBehaviors(),
    assertModeInHistory(mode),
  ]
}

/**
 * Onboard presets: git init, settings, wm.yaml, templates.
 */
export const onboardPresets: EvalCheckpoint[] = [
  assertGitInitialized(),
  assertSettingsExist(),
  assertWmYamlExists(),
  assertTemplatesExist(),
]
