/**
 * Research Mode Eval
 *
 * Scenario: Pre-configured project, agent enters research mode and explores a topic.
 * Tests that hooks and templates properly control the agent — no maxTurns safety net.
 *
 * Asserts:
 * 1. Agent entered research mode (state.json shows research)
 * 2. Agent stayed in research mode (did NOT switch to planning/implementation)
 * 3. Research findings doc created in configured research_path
 * 4. No spec files created (research mode doesn't write specs)
 * 5. Changes committed
 * 6. kata can-exit passes
 */

import type { EvalScenario } from '../harness.js'
import {
  workflowPresets,
  assertStayedInMode,
  assertResearchDocCreated,
  assertNoArtifacts,
} from '../assertions.js'

export const researchModeScenario: EvalScenario = {
  id: 'research-mode',
  name: 'Research mode — explore and document findings',
  templatePath: '.claude/workflows/templates/research.md',
  prompt:
    'Research how this project could add database persistence — ' +
    'explore what ORM/driver options exist for a Node/Express app, ' +
    'what migration strategies work, and how to structure the data layer. ' +
    'Document findings.',
  timeoutMs: 15 * 60 * 1000,
  checkpoints: [
    ...workflowPresets('research'),
    assertStayedInMode('research'),
    assertResearchDocCreated(),
    assertNoArtifacts('planning/specs'),
  ],
}
