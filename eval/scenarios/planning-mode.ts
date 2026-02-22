/**
 * Planning Mode Eval
 *
 * Scenario: "Plan a user authentication feature for the web app"
 *
 * Asserts:
 * 1. Claude enters planning mode (currentMode: planning)
 * 2. A spec file is created at the configured spec_path
 * 3. Spec frontmatter has status: approved
 * 4. Spec body includes at least one behavior section (### B1:)
 * 5. Spec is committed
 * 6. Planning mode appears in session history
 */

import type { EvalScenario } from '../harness.js'
import { planningPresets } from '../assertions.js'

export const planningModeScenario: EvalScenario = {
  id: 'planning-mode',
  name: 'Planning mode: user authentication feature spec',
  templatePath: '.claude/workflows/templates/planning.md',
  prompt:
    'Plan a user authentication feature for this web app. ' +
    'The feature should cover JWT-based auth with login and protected routes. ' +
    'Produce an approved spec and commit it.',
  timeoutMs: 15 * 60 * 1000,
  checkpoints: planningPresets(),
}
