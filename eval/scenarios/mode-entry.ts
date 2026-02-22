/**
 * Mode Entry Smoke Test
 *
 * Quick eval: does the inner agent enter a mode in the CORRECT project?
 * Stops after a few turns — just enough to verify session isolation.
 *
 * These assertions are isolation-specific and intentionally inline —
 * they test harness mechanics (session isolation), not workflow outcomes.
 *
 * Asserts:
 * 1. Session state.json exists in the eval project (not parent)
 * 2. Mode is research (not default)
 * 3. workflowDir points to eval project, not parent
 */

import type { EvalScenario, EvalCheckpoint } from '../harness.js'

const assertStateInProject: EvalCheckpoint = {
  name: 'Session state exists in eval project',
  assert: (ctx) => {
    const stateFiles = ctx.run(
      'find .claude/sessions -name state.json -type f 2>/dev/null | head -1',
    )
    if (!stateFiles || !stateFiles.trim()) {
      return 'No session state.json found in eval project'
    }
    return null
  },
}

const assertModeIsResearch: EvalCheckpoint = {
  name: 'Mode is research',
  assert: (ctx) => {
    const stateFiles = ctx.run(
      'find .claude/sessions -name state.json -type f 2>/dev/null | head -1',
    )
    if (!stateFiles) return 'No state.json'
    const content = ctx.readFile(stateFiles.trim())
    try {
      const state = JSON.parse(content)
      const isResearch =
        state.currentMode === 'research' ||
        state.sessionType === 'research' ||
        state.modeHistory?.some((h: { mode: string }) => h.mode === 'research')
      if (!isResearch) {
        return `Mode is "${state.currentMode || state.sessionType}", expected research`
      }
      return null
    } catch {
      return 'state.json is not valid JSON'
    }
  },
}

const assertWorkflowDirCorrect: EvalCheckpoint = {
  name: 'workflowDir points to eval project',
  assert: (ctx) => {
    const stateFiles = ctx.run(
      'find .claude/sessions -name state.json -type f 2>/dev/null | head -1',
    )
    if (!stateFiles) return 'No state.json'
    const content = ctx.readFile(stateFiles.trim())
    try {
      const state = JSON.parse(content)
      const wfDir: string = state.workflowDir ?? ''
      if (!wfDir.includes(ctx.projectDir)) {
        return `workflowDir "${wfDir}" does not contain project dir "${ctx.projectDir}"`
      }
      return null
    } catch {
      return 'state.json is not valid JSON'
    }
  },
}

export const modeEntryScenario: EvalScenario = {
  id: 'mode-entry',
  name: 'Mode entry smoke test — verify session isolation',
  prompt: 'research adding auth',
  maxTurns: 5,
  timeoutMs: 3 * 60 * 1000,
  checkpoints: [
    assertStateInProject,
    assertModeIsResearch,
    assertWorkflowDirCorrect,
  ],
}
