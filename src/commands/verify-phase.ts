// kata verify-phase - Run per-phase verification (build → typecheck → tests → smoke → delta → review)
// All commands read from wm.yaml — zero hardcoded project assumptions.
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCurrentSessionId, findClaudeProjectDir, getStateFilePath } from '../session/lookup.js'
import { readState } from '../state/reader.js'
import { loadWmConfig } from '../config/wm-config.js'

interface StepResult {
  name: string
  passed: boolean
  skipped?: boolean
  output?: string
}

interface EvidenceFile {
  phaseId: string
  issueNumber: number
  timestamp: string
  steps: StepResult[]
  overallPassed: boolean
}

/**
 * Parse arguments for verify-phase command
 */
function parseArgs(args: string[]): {
  phaseId?: string
  issueNumber?: number
  force: boolean
  json: boolean
  session?: string
} {
  const result = { force: false, json: false } as ReturnType<typeof parseArgs>

  for (const arg of args) {
    if (arg === '--force') {
      result.force = true
    } else if (arg === '--json') {
      result.json = true
    } else if (arg.startsWith('--issue=')) {
      result.issueNumber = parseInt(arg.slice('--issue='.length), 10)
    } else if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    } else if (!arg.startsWith('-')) {
      result.phaseId = arg
    }
  }

  return result
}

/**
 * Resolve issue number from CLI arg or session state
 */
async function resolveIssueNumber(
  issueFromArg: number | undefined,
  sessionArg: string | undefined,
): Promise<number | undefined> {
  if (issueFromArg !== undefined) return issueFromArg

  try {
    const sessionId = sessionArg ?? (await getCurrentSessionId())
    if (!sessionId) return undefined
    const stateFile = await getStateFilePath(sessionId)
    if (!existsSync(stateFile)) return undefined
    const state = await readState(stateFile)
    return state?.issueNumber ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Run a shell command and return a step result.
 * If command is null/undefined, step is skipped.
 */
function runStep(name: string, command: string | null | undefined): StepResult {
  if (!command) {
    return { name, passed: true, skipped: true }
  }

  const result = spawnSync(command, { shell: true, encoding: 'utf-8', stdio: 'pipe' })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  const passed = result.status === 0

  return { name, passed, output: output || undefined }
}

/**
 * Get test file patterns from config (comma-separated glob list)
 */
function getTestFilePatterns(pattern: string): string[] {
  return pattern.split(',').map((p) => p.trim()).filter(Boolean)
}

/**
 * Get changed test files vs diff base
 */
function getChangedTestFiles(diffBase: string, testPatterns: string[]): string[] {
  try {
    const stagedAndCommitted = execSync(
      `git diff --name-only "${diffBase}...HEAD" 2>/dev/null || true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    const workingTree = execSync(
      'git diff --name-only 2>/dev/null || true',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    const allFiles = new Set<string>()
    for (const line of [...stagedAndCommitted.split('\n'), ...workingTree.split('\n')]) {
      if (line.trim()) allFiles.add(line.trim())
    }

    return [...allFiles].filter((file) =>
      testPatterns.some((pattern) => {
        // Simple glob: *.test.ts matches any path ending in .test.ts
        const ext = pattern.replace(/^\*/, '')
        return file.endsWith(ext)
      }),
    )
  } catch {
    return []
  }
}

/**
 * Count assertion patterns in a string
 */
function countAssertions(content: string): number {
  const pattern = /expect\(|assert\.|\.toBe\(|\.toEqual\(|\.toMatch\(|\.toThrow\(/g
  return (content.match(pattern) ?? []).length
}

/**
 * Run assertion delta check — detects test gaming (removing assertions to pass)
 */
function runAssertionDelta(diffBase: string, testPatterns: string[], force: boolean): StepResult {
  const changedFiles = getChangedTestFiles(diffBase, testPatterns)

  if (changedFiles.length === 0) {
    return { name: 'delta', passed: true, skipped: true, output: 'No test files changed' }
  }

  if (force) {
    return {
      name: 'delta',
      passed: true,
      skipped: true,
      output: 'Assertion delta check skipped (--force)',
    }
  }

  let totalBefore = 0
  let totalAfter = 0

  for (const file of changedFiles) {
    try {
      // Count assertions in base version
      const beforeContent = execSync(
        `git show "${diffBase}:${file}" 2>/dev/null || echo ""`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      )
      totalBefore += countAssertions(beforeContent)
    } catch {
      // File is new — before count is 0
    }

    try {
      // Count assertions in working tree
      if (existsSync(file)) {
        const afterContent = readFileSync(file, 'utf-8')
        totalAfter += countAssertions(afterContent)
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (totalAfter < totalBefore) {
    return {
      name: 'delta',
      passed: false,
      output: `Assertion count decreased (before: ${totalBefore}, after: ${totalAfter}, delta: ${totalAfter - totalBefore}). Tests may have been removed to pass. Use --force to override.`,
    }
  }

  return {
    name: 'delta',
    passed: true,
    output: `Assertion count OK (before: ${totalBefore}, after: ${totalAfter})`,
  }
}

/**
 * Extract a phase section from a spec file.
 * Returns empty string if not found (non-fatal).
 */
function getSpecSection(specPath: string, issueNumber: number, phaseId: string): string {
  try {
    // Glob planning/specs/<issue>-*.md
    const dir = specPath
    if (!existsSync(dir)) return ''

    const files = readdirSyncGlob(dir, issueNumber)
    if (!files.length) return ''

    const specContent = readFileSync(files[0], 'utf-8')

    // Match: ### Phase p1 or ### Phase 1 (case-insensitive)
    const numericId = phaseId.replace(/^p/i, '')
    const regex = new RegExp(
      `^###\\s+Phase\\s+(?:p?${numericId}|${phaseId})[\\s:]`,
      'im',
    )
    const match = regex.exec(specContent)
    if (!match || match.index === undefined) return ''

    const start = match.index
    // Find next ## or ### Phase heading
    const rest = specContent.slice(start + match[0].length)
    const nextSection = /^(?:##|###\s+Phase\s)/im.exec(rest)
    const end = nextSection ? start + match[0].length + nextSection.index : specContent.length

    return specContent.slice(start, end).trim()
  } catch {
    return ''
  }
}

/**
 * Find spec files matching issue number in a directory
 */
function readdirSyncGlob(dir: string, issueNumber: number): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.startsWith(`${issueNumber}-`) && f.endsWith('.md'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

/**
 * Run LLM micro-review on phase diff (scoped to security/perf/scope).
 * Skipped if no code_reviewer configured.
 */
function runMicroReview(
  phaseId: string,
  issueNumber: number,
  diffBase: string,
  testPatterns: string[],
  specSection: string,
  reviewer: string | null | undefined,
): StepResult {
  if (!reviewer) {
    return {
      name: 'micro-review',
      passed: true,
      skipped: true,
      output: 'No code_reviewer configured in wm.yaml — micro-review skipped',
    }
  }

  try {
    // Get diff of non-test files
    const allChanged = execSync(
      `git diff --name-only "${diffBase}...HEAD" 2>/dev/null || true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim().split('\n').filter(Boolean)

    const prodFiles = allChanged.filter(
      (f) => !testPatterns.some((p) => f.endsWith(p.replace(/^\*/, ''))),
    )

    if (prodFiles.length === 0) {
      return {
        name: 'micro-review',
        passed: true,
        skipped: true,
        output: 'No production file changes to review',
      }
    }

    let diff = execSync(
      `git diff "${diffBase}...HEAD" -- ${prodFiles.map((f) => `"${f}"`).join(' ')} 2>/dev/null || true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const MAX_DIFF_LINES = 500
    const diffLines = diff.split('\n')
    if (diffLines.length > MAX_DIFF_LINES) {
      diff = diffLines.slice(0, MAX_DIFF_LINES).join('\n') +
        '\n\n[Diff truncated at 500 lines — review remaining files manually]'
    }

    const specCtx = specSection
      ? `\n\nSpec section for Phase ${phaseId}:\n${specSection}`
      : '\n\n[Spec section not found — reviewing without spec context]'

    const prompt = `Code passes its tests. Review this diff for:
1. Security vulnerabilities (injection, XSS, unvalidated input, secrets in code)
2. Performance regressions (blocking I/O, excessive allocation in hot paths)
3. Scope drift — does this diff match the spec section? Flag unrequested changes.
4. Pattern compliance — follows project conventions?

Do NOT flag style, naming, or things covered by tests.
Return: PASS or FAIL with specific line references.
${specCtx}

DIFF:
${diff}`

    // Invoke configured reviewer
    const result = spawnSync(reviewer, ['--inline', prompt], {
      shell: true,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120_000,
    })

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()

    if (result.status !== 0 || result.error) {
      return {
        name: 'micro-review',
        passed: false,
        output: `Review timed out or errored — re-run verify-phase to retry. ${output}`.trim(),
      }
    }

    // Check for critical issues marker
    const passed = !output.includes('🔴')
    return { name: 'micro-review', passed, output }
  } catch (err) {
    return {
      name: 'micro-review',
      passed: false,
      output: `Micro-review error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Write per-phase evidence file to .claude/verification-evidence/phase-<id>-<issue>.json
 * Does NOT touch {issue}.json — that file is owned by the configured code reviewer.
 */
function writeEvidenceFile(
  projectRoot: string,
  phaseId: string,
  issueNumber: number,
  steps: StepResult[],
): void {
  const dir = join(projectRoot, '.claude', 'verification-evidence')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const evidence: EvidenceFile = {
    phaseId,
    issueNumber,
    timestamp: new Date().toISOString(),
    steps,
    overallPassed: steps.every((s) => s.passed),
  }

  const path = join(dir, `phase-${phaseId}-${issueNumber}.json`)
  writeFileSync(path, JSON.stringify(evidence, null, 2))
}

/**
 * Print a human-readable step result line
 */
function printStep(step: StepResult): void {
  const icon = step.skipped ? '⏭' : step.passed ? '✅' : '❌'
  const label = step.skipped ? 'SKIPPED' : step.passed ? 'PASS' : 'FAIL'
  console.log(`  ${icon} ${step.name}: ${label}`)
  if (step.output && (!step.passed || step.skipped)) {
    const lines = step.output.split('\n').slice(0, 10)
    for (const line of lines) {
      console.log(`     ${line}`)
    }
    if (step.output.split('\n').length > 10) {
      console.log('     [output truncated]')
    }
  }
}

/**
 * Main verify-phase entrypoint
 */
export async function verifyPhase(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  if (!parsed.phaseId) {
    console.error('Usage: kata verify-phase <phase-id> [--issue=N] [--force] [--json]')
    process.exit(1)
  }

  const cfg = loadWmConfig()
  const project = cfg.project ?? {}
  const diffBase = project.diff_base ?? 'origin/main'
  const testFilePattern = project.test_file_pattern ?? '*.test.ts,*.spec.ts'
  const testPatterns = getTestFilePatterns(testFilePattern)

  const issueNumber = await resolveIssueNumber(parsed.issueNumber, parsed.session)
  if (issueNumber === undefined) {
    console.error(
      'Error: Issue number required. Pass --issue=<N> or link session: kata link <N>',
    )
    process.exit(1)
  }

  let projectRoot: string
  try {
    projectRoot = findClaudeProjectDir()
  } catch {
    console.error('Error: Not in a kata-wm project directory')
    process.exit(1)
  }

  const specPath = join(projectRoot, cfg.spec_path ?? 'planning/specs')

  console.log(`\n🔍 verify-phase ${parsed.phaseId} (issue #${issueNumber})`)
  console.log(`   diff base: ${diffBase}`)
  console.log('')

  const steps: StepResult[] = []

  // Step 1: Build
  const buildStep = runStep('build', project.build_command)
  steps.push(buildStep)
  printStep(buildStep)
  if (!buildStep.passed) {
    await finalize(projectRoot, parsed.phaseId, issueNumber, steps, parsed.json)
    process.exit(1)
  }

  // Step 2: Typecheck
  const typecheckStep = runStep('typecheck', project.typecheck_command)
  steps.push(typecheckStep)
  printStep(typecheckStep)
  if (!typecheckStep.passed) {
    await finalize(projectRoot, parsed.phaseId, issueNumber, steps, parsed.json)
    process.exit(1)
  }

  // Step 3: Tests
  const testStep = runStep('tests', project.test_command)
  steps.push(testStep)
  printStep(testStep)
  if (!testStep.passed) {
    await finalize(projectRoot, parsed.phaseId, issueNumber, steps, parsed.json)
    process.exit(1)
  }

  // Step 4: Smoke
  const smokeStep = runStep('smoke', project.smoke_command)
  steps.push(smokeStep)
  printStep(smokeStep)
  if (!smokeStep.passed) {
    await finalize(projectRoot, parsed.phaseId, issueNumber, steps, parsed.json)
    process.exit(1)
  }

  // Step 5: Assertion delta
  const deltaStep = runAssertionDelta(diffBase, testPatterns, parsed.force)
  steps.push(deltaStep)
  printStep(deltaStep)
  if (!deltaStep.passed) {
    await finalize(projectRoot, parsed.phaseId, issueNumber, steps, parsed.json)
    process.exit(1)
  }

  // Step 6: Micro-review (only if all prior steps passed)
  const specSection = getSpecSection(specPath, issueNumber, parsed.phaseId)
  if (!specSection) {
    console.log(
      `  [warn] spec section for phase ${parsed.phaseId} not found — micro-review runs without spec context`,
    )
  }
  const reviewStep = runMicroReview(
    parsed.phaseId,
    issueNumber,
    diffBase,
    testPatterns,
    specSection,
    cfg.reviews?.code_reviewer,
  )
  steps.push(reviewStep)
  printStep(reviewStep)

  await finalize(projectRoot, parsed.phaseId, issueNumber, steps, parsed.json)

  const allPassed = steps.every((s) => s.passed)
  console.log('')
  console.log(allPassed ? '✅ All steps passed.' : '❌ Verification failed.')
  process.exit(allPassed ? 0 : 1)
}

async function finalize(
  projectRoot: string,
  phaseId: string,
  issueNumber: number,
  steps: StepResult[],
  json: boolean,
): Promise<void> {
  writeEvidenceFile(projectRoot, phaseId, issueNumber, steps)

  if (json) {
    const evidence: EvidenceFile = {
      phaseId,
      issueNumber,
      timestamp: new Date().toISOString(),
      steps,
      overallPassed: steps.every((s) => s.passed),
    }
    console.log(JSON.stringify(evidence, null, 2))
  }
}
