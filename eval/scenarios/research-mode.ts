/**
 * Research Mode Eval
 *
 * Scenario: Pre-configured project, agent enters research mode and explores a topic.
 *
 * Asserts:
 * 1. Agent entered research mode (state.json shows research)
 * 2. Research findings doc created in planning/research/
 * 3. Changes committed
 * 4. kata can-exit passes
 */

import type { EvalScenario, EvalCheckpoint } from '../harness.js'

const assertResearchMode: EvalCheckpoint = {
  name: 'Agent entered research mode',
  assert: (ctx) => {
    const stateFiles = ctx.run(
      'find .claude/sessions -name state.json -type f 2>/dev/null | head -1',
    )
    if (!stateFiles) {
      return 'No session state.json found'
    }
    const content = ctx.readFile(stateFiles.trim())
    try {
      const state = JSON.parse(content)
      if (state.sessionType !== 'research' && state.currentMode !== 'research') {
        return `Mode is ${state.currentMode || state.sessionType}, expected research`
      }
      return null
    } catch {
      return 'state.json is not valid JSON'
    }
  },
}

const assertFindingsDoc: EvalCheckpoint = {
  name: 'Research findings document created',
  assert: (ctx) => {
    // Read research_path from wm.yaml (default: planning/research)
    const researchPath = ctx.run(
      "grep 'research_path:' .claude/workflows/wm.yaml 2>/dev/null | awk '{print $2}'",
    )?.trim() || 'planning/research'
    const docs = ctx.run(
      `find ${researchPath} -name "*.md" -type f 2>/dev/null | head -5`,
    )
    if (!docs || docs.trim().length === 0) {
      return `No research doc found in ${researchPath}/`
    }
    return null
  },
}

const assertChangesCommitted: EvalCheckpoint = {
  name: 'Changes committed',
  assert: (ctx) => {
    // Check that there's at least one commit beyond the initial scaffold
    const commitCount = ctx.run('git rev-list --count HEAD 2>/dev/null')
    if (!commitCount || parseInt(commitCount.trim(), 10) < 2) {
      return 'No new commits beyond initial scaffold'
    }
    return null
  },
}

const assertCanExit: EvalCheckpoint = {
  name: 'kata can-exit passes',
  assert: (ctx) => {
    const result = ctx.run('kata can-exit 2>&1')
    if (!result || result.includes('BLOCKED')) {
      return `can-exit failed: ${result?.trim() || 'no output'}`
    }
    return null
  },
}

export const researchModeScenario: EvalScenario = {
  id: 'research-mode',
  name: 'Research mode — explore routing patterns',
  prompt:
    'I want to research how routing works in this TanStack Start app. Enter research mode and explore.',
  maxTurns: 60,
  timeoutMs: 15 * 60 * 1000,
  checkpoints: [
    assertResearchMode,
    assertFindingsDoc,
    assertChangesCommitted,
    assertCanExit,
  ],
}
