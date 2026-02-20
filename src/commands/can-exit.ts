// wm can-exit - Check if exit conditions are met (native task-based)
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCurrentSessionId, findClaudeProjectDir, getStateFilePath } from '../session/lookup.js'
import { readState } from '../state/reader.js'
import {
  type StopGuidance,
  getArtifactMessage,
  getEscapeHatchMessage,
  getNextStepMessage,
} from '../messages/stop-guidance.js'
import {
  countPendingNativeTasks,
  getFirstPendingNativeTask,
  getNativeTasksDir,
  getPendingNativeTaskTitles,
} from './enter/task-factory.js'
import { loadWmConfig } from '../config/wm-config.js'

/**
 * Parse command line arguments for can-exit command
 */
function parseArgs(args: string[]): {
  json?: boolean
  session?: string
} {
  const result: { json?: boolean; session?: string } = {}

  for (const arg of args) {
    if (arg === '--json') {
      result.json = true
    } else if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    }
  }

  return result
}

/**
 * Check global conditions (committed, pushed)
 */
function checkGlobalConditions(): { passed: boolean; reasons: string[] } {
  const reasons: string[] = []

  try {
    // Check for uncommitted changes
    const gitStatus = execSync('git status --porcelain 2>/dev/null || true', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    if (gitStatus) {
      // Filter to only tracked files (not ?? untracked)
      const changedFiles = gitStatus.split('\n').filter((line) => !line.startsWith('??'))

      if (changedFiles.length > 0) {
        reasons.push('Uncommitted changes in tracked files')
      }
    }

    // Check if HEAD has been pushed to ANY remote
    // Worktrees may have multiple remotes (origin, github) and some may refuse
    // pushes (e.g., origin points to a non-bare repo with the branch checked out).
    // Rather than checking a specific remote, check if any remote branch contains HEAD.
    const remoteBranches = execSync('git branch -r --contains HEAD 2>/dev/null || true', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    if (!remoteBranches) {
      // HEAD is not on any remote branch — unpushed
      reasons.push('Unpushed commits')
    }
  } catch {
    // Git errors shouldn't block exit
  }

  return {
    passed: reasons.length === 0,
    reasons,
  }
}

/**
 * Check verification evidence for implementation mode
 * Supports any reviewer (codex, gemini) or custom verify_command output.
 * Returns artifact type for guidance lookup instead of hardcoded message.
 */
function checkVerificationEvidence(issueNumber: number | undefined): {
  passed: boolean
  artifactType?: 'verification_not_run' | 'verification_failed'
} {
  if (!issueNumber) return { passed: true } // Skip if no issue linked

  try {
    // Resolve absolute path via findClaudeProjectDir so can-exit works from any subdirectory
    // and hook invocations don't falsely report evidence missing
    const projectRoot = findClaudeProjectDir()
    const evidenceFile = join(
      projectRoot,
      '.claude',
      'verification-evidence',
      `${issueNumber}.json`,
    )
    if (!existsSync(evidenceFile)) {
      return { passed: false, artifactType: 'verification_not_run' }
    }
    const evidence = readFileSync(evidenceFile, 'utf-8').trim()
    const parsed = JSON.parse(evidence)

    // Check if verification passed
    if (parsed.passed === true) {
      return { passed: true }
    }

    // Check if verification was run at all
    if (!parsed.verifiedAt) {
      return {
        passed: false,
        artifactType: 'verification_not_run',
      }
    }

    // Verification was run but failed
    return {
      passed: false,
      artifactType: 'verification_failed',
    }
  } catch {
    // No evidence file - verification not run
    return {
      passed: false,
      artifactType: 'verification_not_run',
    }
  }
}

/**
 * Check if exit conditions are met based on native tasks (~/.claude/tasks/{session}/)
 * Returns artifact type for guidance messages instead of hardcoded strings
 */
function validateCanExit(
  _workflowId: string,
  sessionId: string,
  sessionType: string,
  issueNumber?: number,
): {
  canExit: boolean
  reasons: string[]
  artifactType?: string
  hasOpenTasks: boolean
  usingTasks: boolean
} {
  const reasons: string[] = []
  let artifactType: string | undefined

  // Skip checks for freeform/default mode
  if (sessionType === 'freeform' || sessionType === 'qa' || sessionType === 'default') {
    return { canExit: true, reasons: [], hasOpenTasks: false, usingTasks: false }
  }

  // Check native tasks (~/.claude/tasks/{session-id}/)
  const pendingCount = countPendingNativeTasks(sessionId)
  const hasOpenTasks = pendingCount > 0
  const usingTasks = existsSync(getNativeTasksDir(sessionId))

  if (hasOpenTasks) {
    const pendingTitles = getPendingNativeTaskTitles(sessionId)
    reasons.push(`${pendingCount} task(s) still pending`)
    for (const title of pendingTitles.slice(0, 5)) {
      reasons.push(`  - ${title}`)
    }
    if (pendingTitles.length > 5) {
      reasons.push(`  ... and ${pendingTitles.length - 5} more`)
    }
  }

  // Check Gemini verification for implementation mode (only if configured)
  if (sessionType === 'implementation') {
    const wmConfig = loadWmConfig()
    // Verification runs when a verify mechanism exists, unless explicitly disabled (code_review: false)
    // Verify mechanism: automated reviewer (codex|gemini) OR custom verify_command in wm.yaml
    // Absence of code_review setting = enabled by default when mechanism is configured (backward-compat)
    const codeReviewDisabled = wmConfig.reviews?.code_review === false
    const reviewer = wmConfig.reviews?.code_reviewer
    const hasVerifyMechanism =
      reviewer === 'codex' || reviewer === 'gemini' || !!wmConfig.verify_command
    const verificationRequired = !codeReviewDisabled && hasVerifyMechanism

    if (verificationRequired) {
      const verifCheck = checkVerificationEvidence(issueNumber)
      if (!verifCheck.passed && verifCheck.artifactType) {
        artifactType = verifCheck.artifactType
        // Add a brief reason (detailed guidance comes from getArtifactMessage)
        reasons.push(
          verifCheck.artifactType === 'verification_not_run'
            ? 'Verification not run'
            : 'Verification failed',
        )
      }
    }
  }

  // Check global conditions (only if tasks are done)
  if (reasons.length === 0) {
    const globalCheck = checkGlobalConditions()
    reasons.push(...globalCheck.reasons)
  }

  return {
    canExit: reasons.length === 0,
    reasons,
    artifactType,
    hasOpenTasks,
    usingTasks,
  }
}

/**
 * Build stop guidance from validation results
 */
function buildStopGuidance(
  canExitNow: boolean,
  hasOpenTasks: boolean,
  usingTasks: boolean,
  sessionId: string,
  artifactType: string | undefined,
  workflowId: string,
  issueNumber: number | undefined,
): StopGuidance | undefined {
  // No guidance needed if can exit
  if (canExitNow) return undefined

  const context = { sessionId, issueNumber, workflowId }

  // Get artifact-specific message if applicable
  const artifactMessage = artifactType ? getArtifactMessage(artifactType, context) : undefined

  // Get next task for next step guidance (only if open)
  let nextPhase: StopGuidance['nextPhase']
  let nextStepMessage: string | undefined
  if (hasOpenTasks && usingTasks) {
    const firstTask = getFirstPendingNativeTask(sessionId)
    if (firstTask) {
      nextPhase = {
        beadId: firstTask.id, // Using beadId field for task id (legacy field name)
        title: firstTask.title,
      }
      // Include pre-formatted message - use TaskUpdate for native tasks
      nextStepMessage = `\n**Next task:** [${firstTask.id}] ${firstTask.title}\n\nComplete with: TaskUpdate(taskId="${firstTask.id}", status="completed")`
    }
  }

  return {
    nextPhase,
    nextStepMessage,
    artifactMessage,
    escapeHatch: getEscapeHatchMessage(),
  }
}

/**
 * wm can-exit [--json] [--session=SESSION_ID]
 * Checks if exit conditions are met (based on native tasks)
 */
export async function canExit(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  const sessionId = parsed.session || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sessionId)
  const state = await readState(stateFile)

  const workflowId = state.workflowId || ''
  const sessionType = state.sessionType || state.currentMode || 'default'
  const issueNumber = state.issueNumber ?? undefined

  const {
    canExit: canExitNow,
    reasons,
    artifactType,
    hasOpenTasks,
    usingTasks,
  } = validateCanExit(workflowId, sessionId, sessionType, issueNumber)

  // Build guidance for stop hook (only if can't exit)
  const guidance = buildStopGuidance(
    canExitNow,
    hasOpenTasks,
    usingTasks,
    sessionId,
    artifactType,
    workflowId,
    issueNumber,
  )

  if (parsed.json) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(
      JSON.stringify(
        {
          canExit: canExitNow,
          reasons,
          guidance,
          workflowId,
          sessionType,
          usingTasks,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
  } else {
    if (canExitNow) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log('✓ All tasks complete. Can exit.')
    } else {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log('✗ Cannot exit:')
      for (const reason of reasons) {
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.log(`  ${reason}`)
      }
      // Show guidance in human-readable form
      if (guidance?.artifactMessage) {
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.log(`\n${guidance.artifactMessage.title}`)
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.log(guidance.artifactMessage.message)
      }
      if (guidance?.nextStepMessage) {
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.log(guidance.nextStepMessage)
      } else if (guidance?.nextPhase) {
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.log(
          getNextStepMessage({ id: guidance.nextPhase.beadId, title: guidance.nextPhase.title }),
        )
      }
    }
  }

  // Exit code 0 if can exit, 1 if not
  process.exitCode = canExitNow ? 0 : 1
}
