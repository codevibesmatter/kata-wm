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
 * The prompt explicitly tells the agent the exact command to enter
 * implementation mode. No GitHub issue exists — issue_handling is advisory only.
 *
 * Asserts:
 * 1. Agent entered implementation mode (not task mode!)
 * 2. Auth library installed (better-auth in package.json)
 * 3. Auth server route created (src/routes/api/auth/$.ts or similar)
 * 4. Auth client module exists
 * 5. Login page exists (src/routes/login.tsx)
 * 6. Dashboard page exists (src/routes/dashboard.tsx)
 * 7. New commits created
 * 8. Changes pushed
 */

import type { EvalScenario, EvalCheckpoint, EvalContext } from '../harness.js'
import { assertCurrentMode, assertNewCommit } from '../assertions.js'

function assertBetterAuthInstalled(): EvalCheckpoint {
  return {
    name: 'better-auth in package.json',
    assert(ctx: EvalContext) {
      if (!ctx.fileExists('package.json')) return 'No package.json'
      const pkg = ctx.readFile('package.json')
      if (!pkg.includes('better-auth')) {
        return 'better-auth not found in package.json dependencies'
      }
      return null
    },
  }
}

function assertAuthRouteCreated(): EvalCheckpoint {
  return {
    name: 'auth API route created',
    assert(ctx: EvalContext) {
      // Better Auth catch-all route — could be at various paths
      const candidates = [
        'src/routes/api/auth/$.ts',
        'src/routes/api/auth/$.tsx',
        'src/routes/api/auth/$$.ts',
        'src/routes/api/auth/$$.tsx',
        'src/routes/api.auth.$.ts',
        'src/routes/api.auth.$.tsx',
      ]
      for (const path of candidates) {
        if (ctx.fileExists(path)) return null
      }
      // Broader search
      const files = ctx.run('find src/routes -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -i auth')
      if (files && files.trim()) return null
      return 'No auth API route found under src/routes/'
    },
  }
}

function assertLoginPageExists(): EvalCheckpoint {
  return {
    name: 'login page exists',
    assert(ctx: EvalContext) {
      if (ctx.fileExists('src/routes/login.tsx')) return null
      if (ctx.fileExists('src/routes/login.ts')) return null
      // Check for (login) group route pattern
      const files = ctx.run('find src/routes -name "*login*" 2>/dev/null')
      if (files && files.trim()) return null
      return 'No login page found at src/routes/login.tsx'
    },
  }
}

function assertDashboardExists(): EvalCheckpoint {
  return {
    name: 'dashboard page exists',
    assert(ctx: EvalContext) {
      if (ctx.fileExists('src/routes/dashboard.tsx')) return null
      if (ctx.fileExists('src/routes/dashboard.ts')) return null
      const files = ctx.run('find src/routes -name "*dashboard*" 2>/dev/null')
      if (files && files.trim()) return null
      return 'No dashboard page found at src/routes/dashboard.tsx'
    },
  }
}

function assertAuthClientExists(): EvalCheckpoint {
  return {
    name: 'auth client module exists',
    assert(ctx: EvalContext) {
      const candidates = [
        'src/lib/auth-client.ts',
        'src/lib/auth-client.tsx',
        'src/utils/auth-client.ts',
        'src/auth-client.ts',
      ]
      for (const path of candidates) {
        if (ctx.fileExists(path)) return null
      }
      const files = ctx.run('find src -name "*auth-client*" -o -name "*authClient*" 2>/dev/null')
      if (files && files.trim()) return null
      return 'No auth client module found'
    },
  }
}

function assertChangesPushed(): EvalCheckpoint {
  return {
    name: 'changes pushed to remote',
    assert(ctx: EvalContext) {
      const status = ctx.run('git status -sb')
      if (status.includes('ahead')) {
        return `Unpushed commits: ${status.split('\n')[0]}`
      }
      return null
    },
  }
}

export const implAuthScenario: EvalScenario = {
  id: 'impl-auth',
  name: 'Implementation mode: Better Auth from approved spec',
  templatePath: '.claude/workflows/templates/implementation.md',
  // No fixture — requires --project pointing at a project with an approved spec.
  // Chain: run planning-auth first, then impl-auth with --project=<planning output dir>
  fixture: 'tanstack-start',
  prompt: [
    'FIRST: Enter implementation mode by running exactly this command:',
    '  kata enter implementation',
    '',
    'Do NOT use task mode. You MUST use implementation mode.',
    'There is no GitHub issue — that is fine, just skip issue-related steps.',
    '',
    'Then read the approved spec: planning/specs/better-auth-integration.md',
    'Implement the Better Auth feature described in that spec.',
    '',
    'The spec has 3 phases:',
    '  P1: Auth Foundation (install, config, API route, client module)',
    '  P2: Auth Pages & Forms (login, signup)',
    '  P3: Auth Context & Route Protection (dashboard, guards, header)',
    '',
    'Commit after each phase. Push when done.',
    'Run typecheck (npx tsc --noEmit) to verify before committing.',
  ].join('\n'),
  timeoutMs: 20 * 60 * 1000,
  checkpoints: [
    assertCurrentMode('implementation'),
    assertBetterAuthInstalled(),
    assertAuthRouteCreated(),
    assertAuthClientExists(),
    assertLoginPageExists(),
    assertDashboardExists(),
    assertNewCommit(),
    assertChangesPushed(),
  ],
}
