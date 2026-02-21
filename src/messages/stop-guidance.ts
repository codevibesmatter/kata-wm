// Stop hook guidance messages
// Centralized here so stop hook doesn't hardcode them
import { loadWmConfig } from '../config/wm-config.js'

export interface ArtifactMessage {
  type: string
  title: string
  message: string
  fixCommand?: string
}

export interface StopGuidance {
  nextPhase?: {
    beadId: string // Legacy field name, used for task ID
    title: string
    instructions?: string
  }
  /** Pre-formatted next step message (use this instead of rebuilding in shell) */
  nextStepMessage?: string
  artifactMessage?: ArtifactMessage
  templateFile?: string
  escapeHatch: string
}

/**
 * Get artifact-specific blocking message
 */
export function getArtifactMessage(
  artifactType: string,
  context: {
    sessionId?: string
    issueNumber?: number
    workflowId?: string
  },
): ArtifactMessage | undefined {
  const { sessionId = '$SESSION_ID', issueNumber } = context
  const issueNum = issueNumber ?? 'NNN'

  switch (artifactType) {
    case 'research_doc': {
      const researchCfg = loadWmConfig()
      const researchPath = researchCfg.research_path ?? 'planning/research'
      return {
        type: 'research_doc',
        title: 'ARTIFACT MISSING: Research document required',
        message: `Research mode P3 (Synthesize) requires a research document.

Create: ${researchPath}/$(date +%Y-%m-%d)-{topic-slug}.md

Template: planning/templates/research-findings.template.md`,
      }
    }

    case 'implementation_commits': {
      const testCmd = loadWmConfig().project?.test_command ?? 'pnpm test'
      return {
        type: 'implementation_commits',
        title: 'ANTI-CHEAT VIOLATION: No commits found',
        message: `You marked tasks as done without actually implementing anything.

REQUIRED before completing tasks:
1. \`${testCmd}\` - run your project test suite
2. \`git add . && git commit -m "..."\` - commit your changes

**"Writing code" ≠ "Done". Code is NEVER done until tests pass and changes are committed.**`,
        fixCommand: 'wm status',
      }
    }

    case 'github_not_finalized':
      return {
        type: 'github_not_finalized',
        title: `BLOCKED: GitHub issue #${issueNum} not finalized`,
        message: `Implementation sessions REQUIRE GitHub finalization before exit.

Run the finalization command (updates GitHub issue status and sets githubFinalized in session state):
\`\`\`bash
bgh finalize ${issueNum}
\`\`\`

If \`bgh\` is not installed, install it first:
\`\`\`bash
# From the project root (pnpm workspace)
pnpm install
# bgh is available as: pnpm bgh finalize ${issueNum}
\`\`\``,
        fixCommand: `cat .claude/sessions/${sessionId}/state.json | jq '.githubFinalized'`,
      }

    case 'verification_not_run': {
      const wmCfg = loadWmConfig()
      const reviewer = wmCfg.reviews?.code_reviewer
      // Use configured verify_command; fall back to project test command
      const verifyCmd =
        wmCfg.verify_command != null
          ? wmCfg.verify_command
          : (wmCfg.project?.test_command ?? reviewer ?? 'your verify command')
      return {
        type: 'verification_not_run',
        title: `BLOCKED: Verification not run for issue #${issueNum}`,
        message: `Implementation sessions require verification evidence before exit.

### Run verification to generate evidence

\`\`\`bash
${verifyCmd}
\`\`\`

Verification reads the spec, checks implementation, and writes:
  .claude/verification-evidence/${issueNum}.json

### Alternatively, disable verification in .claude/workflows/wm.yaml

\`\`\`yaml
reviews:
  code_review: false
\`\`\``,
        fixCommand: `cat .claude/verification-evidence/${issueNum}.json | jq '.passed'`,
      }
    }

    case 'verification_failed': {
      const failedCfg = loadWmConfig()
      const failedReviewer = failedCfg.reviews?.code_reviewer
      const failedVerifyCmd =
        failedCfg.verify_command != null
          ? failedCfg.verify_command
          : (failedCfg.project?.test_command ?? failedReviewer ?? 'your verify command')
      return {
        type: 'verification_failed',
        title: `BLOCKED: Verification FAILED for issue #${issueNum}`,
        message: `The verification ran but did not pass.

Check the evidence file for details:
\`\`\`bash
cat .claude/verification-evidence/${issueNum}.json | jq '.'
\`\`\`

**To fix:**
1. Read the verification evidence to understand what failed
2. Fix the failing behaviors in your implementation
3. Re-run verification to update the evidence file:
\`\`\`bash
${failedVerifyCmd}
\`\`\``,
      }
    }

    case 'verification_stale': {
      const staleCfg = loadWmConfig()
      const staleReviewer = staleCfg.reviews?.code_reviewer
      const staleVerifyCmd =
        staleCfg.verify_command != null
          ? staleCfg.verify_command
          : (staleCfg.project?.test_command ?? staleReviewer ?? 'your verify command')
      return {
        type: 'verification_stale',
        title: `BLOCKED: Verification evidence is stale for issue #${issueNum}`,
        message: `The verification evidence predates the latest commit. Re-run verification to generate fresh evidence.

\`\`\`bash
${staleVerifyCmd}
\`\`\`

Evidence file: .claude/verification-evidence/${issueNum}.json`,
        fixCommand: `cat .claude/verification-evidence/${issueNum}.json | jq '.verifiedAt'`,
      }
    }

    default:
      return undefined
  }
}

/**
 * Get the escape hatch message (always the same)
 */
export function getEscapeHatchMessage(): string {
  return `**🚨 ONLY IF GENUINELY BLOCKED:**
If you have a legitimate question that prevents progress (e.g., unclear requirements,
ambiguous spec, need user decision), use \`AskUserQuestion\` to get clarification.
The conversation will pause until user responds, then you can continue.
**DO NOT abuse this to skip conditions.** Only for genuine blockers where you cannot proceed.`
}

/**
 * Get next step guidance message
 */
export function getNextStepMessage(nextTask?: { id: string; title: string }): string {
  if (!nextTask) {
    return ''
  }

  return `**🎯 NEXT STEP (DO NOT SKIP):**
1. DO THE ACTUAL WORK for this task
2. When work is COMPLETE: Mark task completed via TodoWrite

**Current task:** ${nextTask.title}

**⚠️ WARNING: Do NOT bulk-complete tasks just to pass this check.**
Each task must be ACTUALLY COMPLETED with real work.
Tasks should be completed IN ORDER, not all at once.

**📏 Session Length is NOT a Limit**
You have UNLIMITED time and 1M context for this session.
Continue until ALL conditions are met.`
}
