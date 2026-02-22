/**
 * Implementation Mode Eval — Better Auth (from approved spec)
 *
 * Realistic continuation: planning produced an approved spec for Better Auth.
 * This scenario enters implementation mode to execute the spec.
 *
 * Uses the tanstack-start fixture which has:
 * - kata batteries installed
 * - Auth research doc at planning/research/RE-395c-0221-auth.md
 * - Approved spec at planning/specs/better-auth-integration.md
 *
 * Asserts:
 * 1. Agent entered implementation mode
 * 2. Substantive code changes made (non-trivial diff)
 * 3. New commits created
 * 4. Changes pushed
 */

import type { EvalScenario } from '../harness.js'
import { workflowPresetsWithPush, assertDiffNonTrivial } from '../assertions.js'

export const implAuthScenario: EvalScenario = {
  id: 'impl-auth',
  name: 'Implementation mode: Better Auth from approved spec',
  templatePath: '.claude/workflows/templates/implementation.md',
  fixture: 'tanstack-start',
  prompt:
    'Implement the authentication feature described in the approved spec at planning/specs/.',
  timeoutMs: 20 * 60 * 1000,
  checkpoints: [
    ...workflowPresetsWithPush('implementation'),
    assertDiffNonTrivial(50),
  ],
}
