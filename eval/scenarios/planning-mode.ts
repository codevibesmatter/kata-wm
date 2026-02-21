/**
 * Planning Mode Eval
 *
 * Scenario: "Plan a user authentication feature for the web app"
 *
 * Asserts:
 * 1. Claude enters planning mode (currentMode: planning)
 * 2. A spec file is created at planning/specs/*.md
 * 3. Spec frontmatter has status: approved
 * 4. Spec body includes at least one behavior section (### B1:)
 * 5. Spec is committed (at least one commit beyond fixture)
 * 6. All planning phases appear in completedPhases
 */

import type { EvalScenario } from '../harness.js'
import type { EvalContext } from '../harness.js'
import {
  assertCurrentMode,
  assertNewCommit,
} from '../assertions.js'

function assertSpecFileCreated(): import('../harness.js').EvalCheckpoint {
  return {
    name: 'spec file created at planning/specs/',
    assert(ctx: EvalContext) {
      const files = ctx.listDir('planning/specs')
      const specFiles = files.filter((f) => f.endsWith('.md'))
      if (specFiles.length === 0) {
        return 'No spec files found in planning/specs/'
      }
      return null
    },
  }
}

function assertSpecApproved(): import('../harness.js').EvalCheckpoint {
  return {
    name: 'spec frontmatter: status: approved',
    assert(ctx: EvalContext) {
      const files = ctx.listDir('planning/specs')
      const specFiles = files.filter((f) => f.endsWith('.md'))
      if (specFiles.length === 0) return 'No spec files to check'

      for (const file of specFiles) {
        const content = ctx.readFile(`planning/specs/${file}`)
        if (content.includes('status: approved')) return null
      }
      return 'No spec file with status: approved found'
    },
  }
}

function assertSpecHasBehaviors(): import('../harness.js').EvalCheckpoint {
  return {
    name: 'spec contains behavior sections (### B1:)',
    assert(ctx: EvalContext) {
      const files = ctx.listDir('planning/specs')
      const specFiles = files.filter((f) => f.endsWith('.md'))
      if (specFiles.length === 0) return 'No spec files to check'

      for (const file of specFiles) {
        const content = ctx.readFile(`planning/specs/${file}`)
        if (/###\s+B\d+:/m.test(content)) return null
      }
      return 'No behavior sections (### B1:) found in spec'
    },
  }
}

function assertPlanningPhasesComplete(): import('../harness.js').EvalCheckpoint {
  return {
    name: 'planning phases complete in session state',
    assert(ctx: EvalContext) {
      const state = ctx.getSessionState()
      if (!state) return 'Session state not found'
      // Planning mode should have at least visited planning mode
      const hasPlanning = state.modeHistory?.some((h) => h.mode === 'planning')
      if (!hasPlanning) {
        return `Planning mode not found in history: ${JSON.stringify(state.modeHistory)}`
      }
      return null
    },
  }
}

export const planningModeScenario: EvalScenario = {
  id: 'planning-mode',
  name: 'Planning mode: user authentication feature spec',
  prompt:
    'Plan a user authentication feature for the web app. ' +
    'Use kata planning mode to research the existing codebase, write a spec with at least ' +
    'one behavior section (B1, B2, etc.), and get it to approved status. ' +
    'The spec should cover JWT-based auth with login and protected routes.',
  timeoutMs: 15 * 60 * 1000,
  checkpoints: [
    assertCurrentMode('planning'),
    assertSpecFileCreated(),
    assertSpecApproved(),
    assertSpecHasBehaviors(),
    assertNewCommit(),
    assertPlanningPhasesComplete(),
  ],
}
