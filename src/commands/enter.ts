// kata enter - Enter a mode
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import {
  getCurrentSessionId,
  getStateFilePath,
  findProjectDir,
  resolveTemplatePath,
} from '../session/lookup.js'
import { readState, stateExists } from '../state/reader.js'
import { writeState } from '../state/writer.js'
import { loadKataConfig, resolveKataModeAlias } from '../config/kata-config.js'
import { generateWorkflowId, generateWorkflowIdForIssue } from '../utils/workflow-id.js'
import { isNativeTasksEnabled } from '../utils/tasks-check.js'
import type { SessionState } from '../state/schema.js'
import { validatePhases, formatValidationErrors } from '../validation/index.js'
import { readFullTemplateContent, type SpecPhase } from '../yaml/index.js'
import { loadSubphasePatterns } from '../config/subphase-patterns.js'
import type { SubphasePattern } from '../validation/schemas.js'

// Import from modular enter command
import { buildWorkflowGuidance } from './enter/guidance.js'
import {
  parseTemplateYaml,
  getPhaseTitlesFromTemplate,
  parseAndValidateTemplatePhases,
  getTemplateReviewerPrompt,
} from './enter/template.js'

/**
 * Output full template content to stderr for context injection
 * Called after entering a mode to provide full workflow instructions
 */
function outputFullTemplateContent(
  templatePath: string,
  modeName: string,
  workflowId: string,
  issueNum?: number,
  currentPhase?: string,
): void {
  try {
    const fullTemplatePath = templatePath.startsWith('/')
      ? templatePath
      : resolveTemplatePath(templatePath)
    const templateContent = readFullTemplateContent(fullTemplatePath)

    if (templateContent) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(
        '═══════════════════════════════════════════════════════════════════════════════',
      )
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(`📋 FULL MODE INSTRUCTIONS: ${modeName}`)
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(`   Workflow: ${workflowId}`)
      if (issueNum) {
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`   Issue: #${issueNum}`)
      }
      if (currentPhase) {
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`   Current Phase: ${currentPhase}`)
      }
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(
        '═══════════════════════════════════════════════════════════════════════════════',
      )
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(templateContent)
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
    }
  } catch {
    // Template read error - silently ignore, guidance already output above
  }
}
import { findSpecFile, parseSpecYaml } from './enter/spec.js'
import {
  type Task,
  buildSpecTasks,
  buildPhaseTasks,
  writeNativeTaskFiles,
} from './enter/task-factory.js'
import { parseArgs, createDefaultState } from './enter/cli.js'
import { createFdNotesFile, createDoctrineNotesFile } from './enter/notes.js'

/**
 * Enter with a custom template (one-off session)
 * Allows using any template file without registering in modes.yaml
 */
async function enterWithCustomTemplate(
  _args: string[],
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const projectRoot = findProjectDir()

  // Resolve template path
  const templatePath = parsed.template!.startsWith('/')
    ? parsed.template!
    : resolve(projectRoot, parsed.template!)

  // Verify template file exists
  if (!existsSync(templatePath)) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(`Template file not found: ${templatePath}`)
    process.exitCode = 1
    return
  }

  // Parse and validate template phases
  const template = parseTemplateYaml(templatePath)
  if (!template?.phases?.length) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(`No phases found in template: ${templatePath}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('Template must have YAML frontmatter with phases array')
    process.exitCode = 1
    return
  }

  // Validate phases
  const validationResult = validatePhases(template.phases, templatePath)
  if (!validationResult.valid) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(formatValidationErrors(validationResult))
    process.exitCode = 1
    return
  }

  // Derive mode name from template filename or use provided mode arg
  const templateFilename = templatePath.split('/').pop()?.replace(/\.md$/, '') || 'custom'
  const modeName = parsed.mode || templateFilename

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.error(`Using custom template: ${templatePath}`)

  const sessionId = parsed.session || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sessionId)

  let state: SessionState
  if (await stateExists(stateFile)) {
    state = await readState(stateFile)
  } else {
    state = createDefaultState(sessionId)
  }

  // Issue number from flag or state
  const issueNum = parsed.issue ?? state.issueNumber ?? undefined

  // Generate workflow ID
  const workflowPrefix = modeName.toUpperCase().slice(0, 2)
  let workflowId: string
  if (issueNum) {
    workflowId = generateWorkflowIdForIssue(issueNum)
  } else {
    workflowId = generateWorkflowId(workflowPrefix, sessionId)
  }

  const now = new Date().toISOString()
  const effectivePhases = template.phases.map((p) => p.id)

  const updated: SessionState = {
    ...state,
    sessionType: modeName,
    currentMode: modeName,
    template: templatePath,
    phases: effectivePhases,
    currentPhase: effectivePhases[0],
    workflowId,
    issueNumber: issueNum,
    modeHistory: [...(state.modeHistory || []), { mode: modeName, enteredAt: now }],
    modeState: {
      ...(state.modeState || {}),
      [modeName]: {
        status: 'active',
        enteredAt: now,
      },
    },
    updatedAt: now,
  }

  // --tmp marks this as a one-off session (still creates tasks and tracks state)
  const isTemporary = parsed.tmp === true

  // Create workflow directory for state tracking
  const workflowDir = join(dirname(stateFile), 'workflow')

  // Create native tasks from template (skip only in dry-run mode)
  if (!parsed.dryRun) {
    // Ensure workflow directory exists
    mkdirSync(workflowDir, { recursive: true })

    // Create native tasks from template phases
    const tasks = buildPhaseTasks(templatePath, workflowId, issueNum)
    if (tasks.length > 0) {
      writeNativeTaskFiles(sessionId, tasks, workflowId, issueNum ?? null)
    }
  }

  const finalState: SessionState = {
    ...updated,
    workflowDir,
    // Mark as temporary/one-off session if --tmp flag was used
    ...(isTemporary && { isTemporary: true }),
  }

  if (!parsed.dryRun) {
    await writeState(stateFile, finalState)

    // Create fd-notes.md for feature-documentation mode (interview context persistence)
    if (modeName === 'feature-documentation' || templatePath.includes('feature-documentation')) {
      const featureDocPath = (finalState as Record<string, unknown>).featureDocPath as
        | string
        | undefined
      const domain = (finalState as Record<string, unknown>).domain as string | undefined
      createFdNotesFile(stateFile, sessionId, featureDocPath, domain)
    }

    // Create doctrine-notes.md for doctrine mode (interview context persistence)
    if (modeName === 'doctrine' || templatePath.includes('doctrine')) {
      const targetLayer = (finalState as Record<string, unknown>).targetLayer as string | undefined
      const targetDoc = (finalState as Record<string, unknown>).targetDoc as string | undefined
      createDoctrineNotesFile(stateFile, sessionId, targetLayer, targetDoc)
    }
  }

  // Get phase titles for guidance
  const phaseTitles = template.phases
    .filter((p) => p.task_config?.title)
    .map((p) => ({
      id: p.id,
      title: p.task_config!.title,
    }))

  // Build guidance
  const guidance = buildWorkflowGuidance(workflowId, modeName, null, phaseTitles, undefined)

  // Output human-readable guidance - native tasks mode
  if (guidance.requiredTodos.length > 0 && !parsed.dryRun) {
    if (!isNativeTasksEnabled()) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('⚠️  WARNING: Native tasks are disabled (CLAUDE_CODE_ENABLE_TASKS=false)')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('   kata workflow tracking requires native tasks. TaskList will not work.')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('   To enable: set CLAUDE_CODE_ENABLE_TASKS=true in ~/.claude/settings.json')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
    }
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('═══════════════════════════════════════════════════════════════════════════════')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`✅ ${guidance.requiredTodos.length} tasks pre-created with dependency chains`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('═══════════════════════════════════════════════════════════════════════════════')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('Tasks are already created. DO NOT create additional tasks with TaskCreate.')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(
      'Follow the dependency chain - blocked tasks cannot start until dependencies complete.',
    )
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('Your FIRST action: Run TaskList to see all tasks and their dependencies.')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('═══════════════════════════════════════════════════════════════════════════════')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
  }

  const action = parsed.dryRun ? 'dry-run' : isTemporary ? 'started-temporary' : 'started'

  // Output full template content for context injection (same as kata prime)
  if (!parsed.dryRun) {
    outputFullTemplateContent(templatePath, modeName, workflowId, issueNum, effectivePhases[0])
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    JSON.stringify(
      {
        success: true,
        mode: modeName,
        customTemplate: templatePath,
        workflowId,
        action,
        sessionType: modeName,
        template: templatePath,
        phases: effectivePhases,
        workflowDir,
        ...(parsed.dryRun && {
          dryRun: true,
          wouldCreateTasks: phaseTitles.length,
          pattern: `${phaseTitles.length} tasks from custom template`,
        }),
        ...(isTemporary && {
          temporary: true,
          note: 'One-off session with custom tracking. Template not registered in modes.yaml.',
        }),
        enteredAt: finalState.updatedAt,
        ...(issueNum && { issueNumber: issueNum }),
        guidance,
      },
      null,
      2,
    ),
  )
}

/**
 * kata enter <mode> [--session=SESSION_ID]
 * Enter a mode, create state if needed
 */
export async function enter(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  // Handle custom template mode
  if (parsed.template) {
    return enterWithCustomTemplate(args, parsed)
  }

  // Session cleanup (before entering mode)
  if (!parsed.skipCleanup && !parsed.dryRun) {
    try {
      const { cleanupOldSessions } = await import('../utils/session-cleanup.js')
      const { loadKataConfig: loadCfg } = await import('../config/kata-config.js')
      const kataCfg = loadCfg()
      const retentionDays = kataCfg.session_retention_days
      const { getKataDir } = await import('../session/lookup.js')
      const projectRoot = findProjectDir()
      const claudeDir = join(projectRoot, getKataDir(projectRoot))
      const sessionId = parsed.session || (await getCurrentSessionId())
      cleanupOldSessions(claudeDir, retentionDays, sessionId)
    } catch {
      // Cleanup failure must not block mode entry
    }
  }

  if (!parsed.mode) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('Usage: kata enter <mode> [--session=SESSION_ID] [--template=PATH]')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('Options:')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('  --session=ID      Session ID to use')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('  --issue=NUM       Link to GitHub issue')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('  --template=PATH   Use custom template for one-off session')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('  --dry-run         Preview what would be created')
    process.exitCode = 1
    return
  }

  const config = loadKataConfig()
  const canonical = resolveKataModeAlias(config, parsed.mode)

  const modeConfig = config.modes[canonical]
  if (!modeConfig) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(`Unknown mode: ${parsed.mode}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(`Available modes: ${Object.keys(config.modes).join(', ')}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('Or use --template=PATH for a custom one-off session')
    process.exitCode = 1
    return
  }

  if (modeConfig.deprecated) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(`Mode '${canonical}' is deprecated.`)
    if (modeConfig.redirect_to) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI error output
      console.error(`Use '${modeConfig.redirect_to}' instead.`)
    }
    process.exitCode = 1
    return
  }

  // Parse template phases EARLY to drive behavior from structure (not mode names)
  // This enables template-driven behavior instead of hardcoded mode checks
  const templatePhases = modeConfig.template
    ? parseAndValidateTemplatePhases(modeConfig.template)
    : null
  const containerPhase = templatePhases?.find((p) => p.container === true)
  const hasContainerPhase = containerPhase !== undefined

  // Resolve subphase pattern: string name → SubphasePattern[], inline array → as-is
  let resolvedSubphasePattern: SubphasePattern[] = []
  if (hasContainerPhase && containerPhase?.subphase_pattern != null) {
    if (typeof containerPhase.subphase_pattern === 'string') {
      const patternConfig = await loadSubphasePatterns()
      const patternName = containerPhase.subphase_pattern
      const patternDef = patternConfig.subphase_patterns[patternName]
      if (!patternDef) {
        const available = Object.keys(patternConfig.subphase_patterns).join(', ')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`Unknown subphase pattern "${patternName}". Available: ${available}`)
        process.exit(1)
      }
      resolvedSubphasePattern = patternDef.steps
    } else {
      resolvedSubphasePattern = containerPhase.subphase_pattern
    }
  }

  const sessionId = parsed.session || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sessionId)

  let state: SessionState
  if (await stateExists(stateFile)) {
    state = await readState(stateFile)
  } else {
    // Create default state if doesn't exist
    state = createDefaultState(sessionId)
  }

  // Determine issue number: --issue flag takes precedence, then session state
  const issueNum = parsed.issue ?? state.issueNumber ?? undefined

  // If --issue flag provided, update state with it
  if (parsed.issue && parsed.issue !== state.issueNumber) {
    // Warn about switching issues (helps user understand what's happening)
    if (state.issueNumber && state.currentMode && state.currentMode !== 'default') {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(`⚠️  Switching from issue #${state.issueNumber} to #${parsed.issue}`)
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(`   Previous mode: ${state.currentMode}`)
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(
        `   Tip: Use 'kata exit' to cleanly close previous workflow, or 'kata init --force' to reset`,
      )
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
    }
    state.issueNumber = parsed.issue
  }

  // For modes with container phases (template-driven), try to load phases from spec
  // Container phase indicates spec phases should be inserted into template
  let specPhases: SpecPhase[] | null = null
  let specPath: string | null = null
  if (hasContainerPhase && issueNum) {
    specPath = findSpecFile(issueNum)
    if (specPath) {
      const specYaml = parseSpecYaml(specPath)
      if (specYaml?.phases?.length) {
        specPhases = specYaml.phases
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`Found spec with ${specPhases.length} phases: ${specPath}`)

        // ENFORCEMENT: Check that at least one phase has tasks
        const totalTasks = specPhases.reduce((sum, p) => sum + (p.tasks?.length ?? 0), 0)
        if (totalTasks === 0) {
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(
            '═══════════════════════════════════════════════════════════════════════════════',
          )
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(`🛑 SPEC VALIDATION FAILED: Cannot enter ${canonical} mode`)
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(
            '═══════════════════════════════════════════════════════════════════════════════',
          )
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(`Spec file found: ${specPath}`)
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(`Phases found: ${specPhases.length}`)
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('PROBLEM: Phases exist but none have tasks defined.')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('Each phase needs a "tasks" array with task descriptions.')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('Example:')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('  phases:')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('    - id: phase-1')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('      name: "Store & State"')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('      tasks:')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('        - "Add login form validation"')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('        - "Create user settings page"')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('TO FIX:')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('  1. Add tasks arrays to each phase in the spec YAML frontmatter')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(`  2. Run: kata validate-spec ${specPath}`)
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(`  3. Then retry: kata enter ${canonical} --issue=${issueNum}`)
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error('')
          // biome-ignore lint/suspicious/noConsole: intentional CLI output
          console.error(
            '═══════════════════════════════════════════════════════════════════════════════',
          )
          process.exit(1)
        }
      } else {
        // ENFORCEMENT: Spec exists but has no valid phases - fail with clear error
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(
          '═══════════════════════════════════════════════════════════════════════════════',
        )
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`🛑 SPEC VALIDATION FAILED: Cannot enter ${canonical} mode`)
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(
          '═══════════════════════════════════════════════════════════════════════════════',
        )
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`Spec file found: ${specPath}`)
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('PROBLEM: Spec has no valid "phases" section in YAML frontmatter.')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('Modes with container phases require specs to define phases like:')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('  ---')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`  github_issue: ${issueNum}`)
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('  phases:')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('    - id: p1')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('      name: "Phase 1 Name"')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('      beads:')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('        - title: "P1: IMPL - Task description"')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('          type: task')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('  ---')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('TO FIX:')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('  1. Add phases to the spec YAML frontmatter')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`  2. Run: kata validate-spec ${specPath}`)
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(`  3. Then retry: kata enter ${canonical} --issue=${issueNum}`)
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error('')
        // biome-ignore lint/suspicious/noConsole: intentional CLI output
        console.error(
          '═══════════════════════════════════════════════════════════════════════════════',
        )
        process.exit(1)
      }
    }
  }

  // Check if already in this mode (resume vs fresh start)
  const isAlreadyInMode = state.currentMode === canonical

  // Use issue-based workflow ID if linked to an issue (persists across sessions)
  // Otherwise use existing workflow ID if resuming, or generate new if fresh start
  let workflowId: string
  if (issueNum) {
    // Issue-based: always use GH#X (persists across sessions)
    workflowId = generateWorkflowIdForIssue(issueNum)
  } else if (isAlreadyInMode && state.workflowId) {
    // Resuming same mode: keep existing workflow ID
    workflowId = state.workflowId
  } else {
    // Fresh start: generate new session-based ID
    workflowId = generateWorkflowId(
      modeConfig.workflow_prefix || canonical.toUpperCase().slice(0, 2),
      sessionId,
    )
  }

  const now = new Date().toISOString()

  // Determine phases to use: spec phases first, then template phases, then modes.yaml fallback
  const effectivePhases = specPhases
    ? specPhases.map((p) => p.id)
    : (templatePhases?.map((p) => p.id) ?? [])

  const updated: SessionState = {
    ...state,
    sessionType: canonical,
    currentMode: canonical,
    template: modeConfig.template,
    phases: effectivePhases,
    currentPhase: effectivePhases[0],
    workflowId,
    issueNumber: issueNum,
    specPath: specPath ?? undefined,
    modeHistory: [...(state.modeHistory || []), { mode: canonical, enteredAt: now }],
    modeState: {
      ...(state.modeState || {}),
      [canonical]: {
        status: 'active',
        enteredAt: now,
      },
    },
    updatedAt: now,
  }

  // Create workflow directory for state tracking
  const workflowDir = join(dirname(stateFile), 'workflow')

  // Build reviewers string for {reviewers} placeholder in review step titles
  // Computed here so it can be used by both spec-based and template-only task builders
  const reviews = config.reviews
  const externalProviders =
    reviews?.code_review !== false
      ? (reviews?.code_reviewers ?? (reviews?.code_reviewer ? [reviews.code_reviewer] : []))
      : []
  // Read reviewer_prompt from template frontmatter (default: 'code-review')
  const reviewerPrompt = modeConfig.template ? getTemplateReviewerPrompt(modeConfig.template) : 'code-review'
  const reviewerParts = [
    'review-agent',
    ...externalProviders.filter(Boolean).map((p) => `kata review --prompt=${reviewerPrompt} --provider=${p}`),
  ]
  const reviewers = reviewerParts.join(', ')

  // Build tasks (always, even for dry-run — so subjects can be included in output)
  let allTasks: Task[] = []

  if (hasContainerPhase && specPhases && issueNum) {
    const containerPhaseNum = containerPhase
      ? Number.parseInt(containerPhase.id.replace('p', ''), 10)
      : 2

    // Create BOTH orchestration tasks (P0, P1, P3, P4, ...) AND spec subphase tasks (P2.X)
    const orchTasks = modeConfig.template
      ? buildPhaseTasks(modeConfig.template, workflowId, issueNum, reviewers)
      : []
    // Read spec file content for VP extraction (used by {verification_plan} placeholder)
    const specContent = specPath ? readFileSync(specPath, 'utf-8') : undefined

    const specTasks = buildSpecTasks(specPhases, issueNum, resolvedSubphasePattern, containerPhaseNum, specContent, reviewers)

      // Wire cross-phase dependencies:
      // - First P2.X:impl depends on last task of P1 (Claim)
      //   P1 may be expanded into steps, so find the last task with id 'p1' or 'p1:*'
      const firstImplId = `p${containerPhaseNum}.1:${resolvedSubphasePattern[0]?.id_suffix ?? 'impl'}`
      const firstImpl = specTasks.find((t) => t.id === firstImplId)
      const lastP1TaskId = [...orchTasks]
        .filter((t) => t.id === 'p1' || t.id.startsWith('p1:'))
        .pop()?.id
      if (firstImpl && lastP1TaskId) {
        firstImpl.depends_on.push(lastP1TaskId)
      }

      // - First task after container (P3) depends on last P2.X subphase task
      //   P3 may be expanded into steps, so find the first task with id 'p3' or 'p3:*'
      const lastPatternSuffix = resolvedSubphasePattern[resolvedSubphasePattern.length - 1]?.id_suffix ?? 'verify'
      const lastVerifyId = `p${containerPhaseNum}.${specPhases.length}:${lastPatternSuffix}`
      const firstP3Task = orchTasks.find((t) => t.id === 'p3' || t.id.startsWith('p3:'))
      if (firstP3Task && specTasks.some((t) => t.id === lastVerifyId)) {
        firstP3Task.depends_on.push(lastVerifyId)
      }

      // Order: before-container (P0, P1), spec tasks (P2.X), after-container (P3, P4)
      const beforeContainer = orchTasks.filter((t) => {
        const num = Number.parseInt(t.id.replace('p', ''), 10)
        return num < containerPhaseNum
      })
      const afterContainer = orchTasks.filter((t) => {
        const num = Number.parseInt(t.id.replace('p', ''), 10)
        return num >= containerPhaseNum
      })
      allTasks = [...beforeContainer, ...specTasks, ...afterContainer]
    } else if (modeConfig.template) {
      allTasks = buildPhaseTasks(modeConfig.template, workflowId, issueNum, reviewers)
    }

  // Write native task files only on real enter (not dry-run)
  if (!parsed.dryRun && allTasks.length > 0) {
    writeNativeTaskFiles(sessionId, allTasks, workflowId, issueNum ?? null)
  }

  const finalState: SessionState = {
    ...updated,
    workflowDir,
  }

  // Skip state write in dry-run mode
  if (!parsed.dryRun) {
    await writeState(stateFile, finalState)
  }

  // Determine action taken (native tasks always recreate, so always 'started')
  const action = parsed.dryRun ? 'dry-run' : 'started'

  const wouldCreateTasks = allTasks.length

  // Get phase titles from template for guidance context
  const phaseTitles = modeConfig.template ? getPhaseTitlesFromTemplate(modeConfig.template) : []

  // Build comprehensive workflow guidance with suggested todos
  // Now passes templatePhases for dynamic reading instead of hardcoding
  // task_system rules from global_behavior flow into stdout JSON for agent consumption
  const guidance = buildWorkflowGuidance(
    workflowId,
    canonical,
    specPhases,
    phaseTitles,
    templatePhases ?? undefined,
    undefined,
    resolvedSubphasePattern.length > 0 ? resolvedSubphasePattern : undefined,
  )

  // Output human-readable guidance to stderr - native tasks mode
  if (guidance.requiredTodos.length > 0 && !isAlreadyInMode && !parsed.dryRun) {
    // Warn if native tasks are disabled — kata's workflow tracking won't work
    if (!isNativeTasksEnabled()) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('⚠️  WARNING: Native tasks are disabled (CLAUDE_CODE_ENABLE_TASKS=false)')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('   kata workflow tracking requires native tasks. TaskList will not work.')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('   To enable: set CLAUDE_CODE_ENABLE_TASKS=true in ~/.claude/settings.json')
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error('')
    }
    // Native tasks mode: tasks already created with dependencies - direct agent to use TaskList
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('═══════════════════════════════════════════════════════════════════════════════')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`✅ ${guidance.requiredTodos.length} tasks pre-created with dependency chains`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('═══════════════════════════════════════════════════════════════════════════════')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('Tasks are already created. DO NOT create additional tasks with TaskCreate.')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(
      'Follow the dependency chain - blocked tasks cannot start until dependencies complete.',
    )
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('Your FIRST action: Run TaskList to see all tasks and their dependencies.')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('🔧 COMMANDS:')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('───────────────────────────────────────────────────────────────────────────────')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`  Status:         ${guidance.commands.listTasks}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`  Can exit:       ${guidance.commands.pendingTasks}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`  Complete task:  ${guidance.commands.completeWithEvidence}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('═══════════════════════════════════════════════════════════════════════════════')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('')
  }

  // Output full template content for context injection (same as kata prime)
  if (!parsed.dryRun && modeConfig.template) {
    outputFullTemplateContent(
      modeConfig.template,
      canonical,
      workflowId,
      issueNum,
      effectivePhases[0],
    )
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    JSON.stringify(
      {
        success: true,
        mode: canonical,
        workflowId,
        action,
        sessionType: canonical,
        template: modeConfig.template,
        phases: effectivePhases,
        workflowDir,
        ...(parsed.dryRun && {
          dryRun: true,
          wouldCreateTasks,
          pattern:
            hasContainerPhase && specPhases
              ? `${templatePhases?.filter((p) => !p.container && p.task_config?.title).length ?? 0} orchestration + ${specPhases.length} phases × ${resolvedSubphasePattern.length || 1} subphases = ${wouldCreateTasks} tasks`
              : `${wouldCreateTasks} tasks`,
        }),
        enteredAt: finalState.updatedAt,
        ...(specPath && { specPath, phasesFromSpec: true }),
        ...(issueNum && { issueNumber: issueNum }),
        tasks: allTasks.map((t) => t.title),
        // guidance contains requiredTodos, workflow steps, and commands
        guidance,
      },
      null,
      2,
    ),
  )
}
