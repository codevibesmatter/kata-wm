/**
 * Task Mode Eval
 *
 * Scenario: "Add a /health route that returns {status: 'ok'} to the web app"
 *
 * Asserts:
 * 1. Claude enters task mode (currentMode: task)
 * 2. A file was changed in the fixture project
 * 3. A commit was made beyond the initial fixture commit
 * 4. kata can-exit returns 0
 * 5. Completed within token budget
 */

import type { EvalScenario } from '../harness.js'
import { workflowPresets, assertDiffContains } from '../assertions.js'

export const taskModeScenario: EvalScenario = {
  id: 'task-mode',
  name: 'Task mode: add /health route',
  templatePath: '.claude/workflows/templates/task.md',
  prompt:
    'Add a `/health` route to the web app that returns `{"status": "ok"}` with HTTP 200.',
  timeoutMs: 10 * 60 * 1000,
  checkpoints: [
    ...workflowPresets('task'),
    assertDiffContains('/health'),
  ],
}
