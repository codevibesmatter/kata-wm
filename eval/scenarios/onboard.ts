/**
 * Onboard Eval
 *
 * Scenario: Fresh TanStack Start project, no kata config. Agent sets up kata.
 *
 * Asserts:
 * 1. .claude/settings.json exists with hooks
 * 2. .claude/workflows/wm.yaml exists
 * 3. .claude/workflows/templates/ has mode templates
 * 4. Git repository is initialized
 */

import type { EvalScenario } from '../harness.js'
import { onboardPresets } from '../assertions.js'

export const onboardScenario: EvalScenario = {
  id: 'onboard',
  name: 'Fresh project onboard',
  fixture: 'tanstack-start',
  prompt:
    'Help me get started with this project. kata-wm is installed globally.',
  maxTurns: 40,
  timeoutMs: 10 * 60 * 1000,
  checkpoints: onboardPresets,
}
