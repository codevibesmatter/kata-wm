/**
 * Tests for eval assertion library.
 *
 * Validates that assertion functions and presets work correctly
 * with mock EvalContext objects.
 */

import { describe, it, expect } from 'bun:test'
import type { EvalContext } from './harness.js'
import {
  assertCurrentMode,
  assertStayedInMode,
  assertModeInHistory,
  assertNewCommit,
  assertCleanWorkingTree,
  assertDiffContains,
  assertDiffNonTrivial,
  assertChangesPushed,
  assertSpecFileCreated,
  assertSpecApproved,
  assertSpecHasBehaviors,
  assertResearchDocCreated,
  assertNoArtifacts,
  assertSettingsExist,
  assertWmYamlExists,
  assertTemplatesExist,
  assertCanExit,
  workflowPresets,
  workflowPresetsWithPush,
  planningPresets,
  onboardPresets,
} from './assertions.js'
import type { SessionState } from '../src/state/schema.js'

// ─── Mock Context Builder ────────────────────────────────────────────────────

function mockContext(overrides: {
  state?: Partial<SessionState> | null
  files?: Record<string, string>
  dirs?: Record<string, string[]>
  runResults?: Record<string, string>
}): EvalContext {
  const files = overrides.files ?? {}
  const dirs = overrides.dirs ?? {}
  const runResults = overrides.runResults ?? {}

  return {
    projectDir: '/tmp/test-project',
    getSessionState() {
      if (overrides.state === null) return null
      return (overrides.state ?? {}) as SessionState
    },
    run(cmd: string) {
      // Check for exact matches first, then prefix matches
      if (runResults[cmd] !== undefined) return runResults[cmd]
      for (const [pattern, result] of Object.entries(runResults)) {
        if (cmd.includes(pattern)) return result
      }
      return ''
    },
    fileExists(rel: string) {
      return rel in files
    },
    readFile(rel: string) {
      return files[rel] ?? ''
    },
    listDir(rel: string) {
      return dirs[rel] ?? []
    },
  }
}

// ─── Session State Assertions ────────────────────────────────────────────────

describe('assertCurrentMode', () => {
  it('passes when mode matches', async () => {
    const ctx = mockContext({ state: { currentMode: 'task' } })
    const result = await assertCurrentMode('task').assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when mode differs', async () => {
    const ctx = mockContext({ state: { currentMode: 'planning' } })
    const result = await assertCurrentMode('task').assert(ctx)
    expect(result).toContain("Expected currentMode 'task'")
  })

  it('fails when no session state', async () => {
    const ctx = mockContext({ state: null })
    const result = await assertCurrentMode('task').assert(ctx)
    expect(result).toContain('Session state not found')
  })
})

describe('assertStayedInMode', () => {
  it('passes when only target mode in history', async () => {
    const ctx = mockContext({
      state: { modeHistory: [{ mode: 'research' }] } as Partial<SessionState>,
    })
    const result = await assertStayedInMode('research').assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when other modes in history', async () => {
    const ctx = mockContext({
      state: {
        modeHistory: [{ mode: 'research' }, { mode: 'planning' }],
      } as Partial<SessionState>,
    })
    const result = await assertStayedInMode('research').assert(ctx)
    expect(result).toContain('planning')
  })

  it('ignores default mode', async () => {
    const ctx = mockContext({
      state: {
        modeHistory: [{ mode: 'default' }, { mode: 'research' }],
      } as Partial<SessionState>,
    })
    const result = await assertStayedInMode('research').assert(ctx)
    expect(result).toBeNull()
  })
})

describe('assertModeInHistory', () => {
  it('passes when mode found in history', async () => {
    const ctx = mockContext({
      state: { modeHistory: [{ mode: 'planning' }] } as Partial<SessionState>,
    })
    const result = await assertModeInHistory('planning').assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when mode not in history', async () => {
    const ctx = mockContext({
      state: { modeHistory: [{ mode: 'task' }] } as Partial<SessionState>,
    })
    const result = await assertModeInHistory('planning').assert(ctx)
    expect(result).toContain('planning mode not found')
  })
})

// ─── Git Assertions ──────────────────────────────────────────────────────────

describe('assertNewCommit', () => {
  it('passes with 2+ commits', async () => {
    const ctx = mockContext({
      runResults: { 'git log --oneline': 'abc123 feat: something\ndef456 Initial scaffold' },
    })
    const result = await assertNewCommit().assert(ctx)
    expect(result).toBeNull()
  })

  it('fails with only 1 commit', async () => {
    const ctx = mockContext({
      runResults: { 'git log --oneline': 'def456 Initial scaffold' },
    })
    const result = await assertNewCommit().assert(ctx)
    expect(result).toContain('Expected at least 2 commits')
  })
})

describe('assertDiffNonTrivial', () => {
  it('passes when diff exceeds minimum', async () => {
    const diffLines = Array(60).fill('+added line').join('\n')
    const ctx = mockContext({
      runResults: {
        'git rev-list --max-parents=0 HEAD': 'abc123',
        'git diff abc123..HEAD': diffLines,
      },
    })
    const result = await assertDiffNonTrivial(50).assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when diff is too small', async () => {
    const ctx = mockContext({
      runResults: {
        'git rev-list --max-parents=0 HEAD': 'abc123',
        'git diff abc123..HEAD': '+one line\n+two line',
      },
    })
    const result = await assertDiffNonTrivial(50).assert(ctx)
    expect(result).toContain('Expected diff >= 50 lines')
  })
})

describe('assertChangesPushed', () => {
  it('passes when not ahead', async () => {
    const ctx = mockContext({
      runResults: { 'git status -sb': '## main...origin/main' },
    })
    const result = await assertChangesPushed().assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when ahead', async () => {
    const ctx = mockContext({
      runResults: { 'git status -sb': '## main...origin/main [ahead 2]' },
    })
    const result = await assertChangesPushed().assert(ctx)
    expect(result).toContain('Unpushed commits')
  })
})

// ─── Artifact Assertions ─────────────────────────────────────────────────────

describe('assertSpecFileCreated (config-driven)', () => {
  it('reads spec_path from wm.yaml', async () => {
    const ctx = mockContext({
      files: { '.claude/workflows/wm.yaml': 'spec_path: custom/specs' },
      dirs: { 'custom/specs': ['feature.md'] },
      // awk '{print $2}' extracts just the value
      runResults: { "grep '^spec_path:'": 'custom/specs' },
    })
    const result = await assertSpecFileCreated().assert(ctx)
    expect(result).toBeNull()
  })

  it('falls back to planning/specs when no wm.yaml', async () => {
    const ctx = mockContext({
      dirs: { 'planning/specs': ['my-spec.md'] },
      runResults: { "grep '^spec_path:'": '' },
    })
    const result = await assertSpecFileCreated().assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when no spec files', async () => {
    const ctx = mockContext({
      dirs: { 'planning/specs': [] },
      runResults: { "grep '^spec_path:'": '' },
    })
    const result = await assertSpecFileCreated().assert(ctx)
    expect(result).toContain('No spec files found')
  })
})

describe('assertNoArtifacts', () => {
  it('passes when directory is empty', async () => {
    const ctx = mockContext({
      runResults: { 'find planning/specs': '' },
    })
    const result = await assertNoArtifacts('planning/specs').assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when artifacts exist', async () => {
    const ctx = mockContext({
      runResults: { 'find planning/specs': 'planning/specs/something.md' },
    })
    const result = await assertNoArtifacts('planning/specs').assert(ctx)
    expect(result).toContain('Unexpected artifacts')
  })
})

// ─── Onboard Assertions ──────────────────────────────────────────────────────

describe('assertSettingsExist', () => {
  it('passes with valid settings', async () => {
    const ctx = mockContext({
      files: {
        '.claude/settings.json': JSON.stringify({
          hooks: { SessionStart: [{ command: 'kata hook session-start' }] },
        }),
      },
    })
    const result = await assertSettingsExist().assert(ctx)
    expect(result).toBeNull()
  })

  it('fails when no hooks key', async () => {
    const ctx = mockContext({
      files: { '.claude/settings.json': '{}' },
    })
    const result = await assertSettingsExist().assert(ctx)
    expect(result).toContain('no hooks key')
  })
})

// ─── Presets ─────────────────────────────────────────────────────────────────

describe('workflowPresets', () => {
  it('returns 4 checkpoints', () => {
    const presets = workflowPresets('task')
    expect(presets).toHaveLength(4)
    expect(presets.map((p) => p.name)).toEqual([
      "session.currentMode === 'task'",
      'git: new commit created',
      'git: working tree is clean',
      'kata can-exit: exits 0',
    ])
  })
})

describe('workflowPresetsWithPush', () => {
  it('returns 5 checkpoints (workflow + pushed)', () => {
    const presets = workflowPresetsWithPush('implementation')
    expect(presets).toHaveLength(5)
    expect(presets[4].name).toBe('git: changes pushed to remote')
  })
})

describe('planningPresets', () => {
  it('returns 9 checkpoints', () => {
    const presets = planningPresets()
    expect(presets).toHaveLength(9)
    const names = presets.map((p) => p.name)
    expect(names).toContain('spec file created')
    expect(names).toContain('spec frontmatter: status: approved')
    expect(names).toContain('spec contains behavior sections')
    expect(names).toContain('planning mode in session history')
  })
})

describe('onboardPresets', () => {
  it('returns 4 checkpoints', () => {
    expect(onboardPresets).toHaveLength(4)
    const names = onboardPresets.map((p) => p.name)
    expect(names).toContain('git repository initialized')
    expect(names).toContain('.claude/settings.json exists with hooks')
    expect(names).toContain('.claude/workflows/wm.yaml exists')
    expect(names).toContain('mode templates seeded')
  })
})
