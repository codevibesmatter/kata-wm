/**
 * Planning Mode Eval — Auth Feature (from research)
 *
 * Realistic continuation: a prior research session produced
 * planning/research/RE-395c-0221-auth.md recommending Better Auth.
 * This scenario enters planning mode to spec the feature.
 *
 * Uses the tanstack-start fixture which already has:
 * - kata batteries installed (hooks, templates, spec-templates)
 * - The auth research doc committed
 * - A local bare remote for git push
 *
 * Asserts:
 * 1. Agent entered planning mode
 * 2. Spec file created at configured spec_path
 * 3. Spec has status: approved in frontmatter
 * 4. Spec has behavior sections (### B1:)
 * 5. New commits created
 * 6. Changes pushed
 */

import type { EvalScenario } from '../harness.js'
import { planningPresets } from '../assertions.js'

export const planningAuthScenario: EvalScenario = {
  id: 'planning-auth',
  name: 'Planning mode: Better Auth feature spec (from research)',
  templatePath: '.claude/workflows/templates/planning.md',
  fixture: 'tanstack-start',
  prompt:
    'Plan user authentication for this TanStack Start app, ' +
    'building on the research findings in planning/research/.',
  timeoutMs: 15 * 60 * 1000,
  checkpoints: planningPresets(),
}
