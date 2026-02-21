/**
 * Onboard Eval
 *
 * Scenario: Fresh TanStack Start project, no kata config. Agent sets up kata.
 *
 * Asserts:
 * 1. .claude/settings.json exists with hooks
 * 2. .claude/workflows/wm.yaml exists
 * 3. .claude/workflows/templates/ has mode templates
 * 4. kata can-exit passes (onboard has no stop conditions)
 */

import type { EvalScenario, EvalCheckpoint } from '../harness.js'

const assertSettingsExist: EvalCheckpoint = {
  name: '.claude/settings.json exists with hooks',
  assert: (ctx) => {
    if (!ctx.fileExists('.claude/settings.json')) {
      return '.claude/settings.json not found'
    }
    const content = ctx.readFile('.claude/settings.json')
    try {
      const settings = JSON.parse(content)
      if (!settings.hooks) {
        return 'settings.json has no hooks key'
      }
      if (!settings.hooks.SessionStart) {
        return 'settings.json missing SessionStart hook'
      }
      return null
    } catch {
      return 'settings.json is not valid JSON'
    }
  },
}

const assertWmYamlExists: EvalCheckpoint = {
  name: '.claude/workflows/wm.yaml exists',
  assert: (ctx) => {
    if (!ctx.fileExists('.claude/workflows/wm.yaml')) {
      return '.claude/workflows/wm.yaml not found'
    }
    const content = ctx.readFile('.claude/workflows/wm.yaml')
    if (!content.includes('project:')) {
      return 'wm.yaml missing project: key'
    }
    return null
  },
}

const assertTemplatesExist: EvalCheckpoint = {
  name: 'Mode templates seeded',
  assert: (ctx) => {
    const templates = ctx.listDir('.claude/workflows/templates')
    if (templates.length === 0) {
      return 'No templates found in .claude/workflows/templates/'
    }
    // At minimum, onboard.md should exist (seeded by kata setup --yes)
    if (!templates.includes('onboard.md')) {
      return 'onboard.md template missing'
    }
    return null
  },
}

const assertGitInitialized: EvalCheckpoint = {
  name: 'Git repository initialized',
  assert: (ctx) => {
    const result = ctx.run('git rev-parse --git-dir 2>/dev/null')
    if (!result) {
      return 'Not a git repository'
    }
    return null
  },
}

export const onboardScenario: EvalScenario = {
  id: 'onboard',
  name: 'Fresh project onboard',
  fixture: 'tanstack-start',
  prompt:
    'Help me get started with this project. kata-wm is installed globally.',
  maxTurns: 40,
  timeoutMs: 10 * 60 * 1000,
  checkpoints: [
    assertGitInitialized,
    assertSettingsExist,
    assertWmYamlExists,
    assertTemplatesExist,
  ],
}
