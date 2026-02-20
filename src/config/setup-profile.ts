// Setup profile for wm setup
// Handles auto-detection of project settings and default profile generation
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * SetupProfile represents the collected answers from the setup interview
 * or auto-detected defaults for the --yes path
 */
export interface SetupProfile {
  project_name: string
  test_command: string | null
  ci: string | null
  spec_path: string
  research_path: string
  session_retention_days: number
  reviews: {
    spec_review: boolean
    code_review: boolean
    code_reviewer: string | null
  }
  strict: boolean
}

/**
 * Detect project name from package.json or directory basename
 */
export function detectProjectName(cwd: string): string {
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, 'utf-8')
      const parsed = JSON.parse(raw) as { name?: string }
      if (parsed.name && typeof parsed.name === 'string') {
        return parsed.name
      }
    } catch {
      // Fall through to basename
    }
  }
  return basename(cwd)
}

/**
 * Detect test command by checking package.json scripts.test and config files
 * Returns the test command string or null if none detected
 */
export function detectTestCommand(cwd: string): string | null {
  // Check package.json scripts.test
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, 'utf-8')
      const parsed = JSON.parse(raw) as { scripts?: { test?: string } }
      if (parsed.scripts?.test && typeof parsed.scripts.test === 'string') {
        const testCmd = parsed.scripts.test
        // Ignore placeholder test scripts
        if (
          !testCmd.includes('no test specified') &&
          testCmd !== 'echo "Error: no test specified" && exit 1'
        ) {
          return testCmd
        }
      }
    } catch {
      // Fall through to config file detection
    }
  }

  // Check for test config files
  const configPatterns: Array<{ glob: string[]; command: string }> = [
    { glob: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'], command: 'vitest' },
    {
      glob: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs'],
      command: 'jest',
    },
    { glob: ['pytest.ini', 'pyproject.toml', 'setup.cfg'], command: 'pytest' },
  ]

  for (const config of configPatterns) {
    for (const file of config.glob) {
      if (existsSync(join(cwd, file))) {
        return config.command
      }
    }
  }

  return null
}

/**
 * Detect CI system by checking for CI config files
 * Returns the CI system name or null if none detected
 */
export function detectCI(cwd: string): string | null {
  // GitHub Actions
  const ghWorkflows = join(cwd, '.github', 'workflows')
  if (existsSync(ghWorkflows)) {
    try {
      const files = readdirSync(ghWorkflows)
      if (files.some((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
        return 'github-actions'
      }
    } catch {
      // Fall through
    }
  }

  // GitLab CI
  if (existsSync(join(cwd, '.gitlab-ci.yml'))) {
    return 'gitlab-ci'
  }

  // CircleCI
  if (existsSync(join(cwd, '.circleci', 'config.yml'))) {
    return 'circleci'
  }

  // Travis CI
  if (existsSync(join(cwd, '.travis.yml'))) {
    return 'travis-ci'
  }

  // Jenkins
  if (existsSync(join(cwd, 'Jenkinsfile'))) {
    return 'jenkins'
  }

  return null
}

/**
 * Generate a default setup profile with auto-detection
 * Used for the --yes fast path that skips the interview
 */
export function getDefaultProfile(cwd?: string): SetupProfile {
  const dir = cwd ?? process.cwd()

  return {
    project_name: detectProjectName(dir),
    test_command: detectTestCommand(dir),
    ci: detectCI(dir),
    spec_path: 'planning/specs',
    research_path: 'planning/research',
    session_retention_days: 7,
    reviews: {
      spec_review: false,
      code_review: false,
      code_reviewer: null,
    },
    strict: false,
  }
}
