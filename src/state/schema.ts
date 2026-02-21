import { z } from 'zod'

/**
 * Session state schema - represents the current state of a Claude Code session
 * including mode, phase, and workflow tracking.
 */
export const SessionStateSchema = z
  .object({
    // Session identity
    sessionId: z.string().uuid().optional(), // Optional for legacy files
    workflowId: z.string().optional(), // Optional for legacy files
    issueNumber: z.number().nullable().optional(), // Can be null in legacy files
    issueType: z.string().optional(), // e.g., "task", "feature", "bug", "chore"
    issueTitle: z.string().optional(), // Issue title for micro planning detection
    title: z.string().optional(), // Alias for issueTitle (from link-issue.sh)
    githubType: z.string().optional(), // GitHub issue type from link-issue.sh

    // Mode tracking
    sessionType: z.string().optional(), // Optional for legacy files
    currentMode: z.string().optional(), // Optional for legacy files
    previousMode: z.string().optional(),

    // Phase tracking
    currentPhase: z.string().nullable().optional(), // Can be null in legacy files
    completedPhases: z.array(z.string()).default([]),

    // Template info
    template: z.string().optional(),
    phases: z.array(z.string()).default([]),

    // Mode history - supports both legacy (array of strings) and new (array of objects) formats
    modeHistory: z
      .array(
        z.union([
          z.string(), // Legacy format: just the mode name
          z.object({
            // New format: full entry with timestamps
            mode: z.string(),
            enteredAt: z.string(),
            exitedAt: z.string().optional(),
          }),
        ]),
      )
      .default([]),

    // State metadata - tracks per-mode state
    modeState: z
      .record(
        z.object({
          status: z.enum(['active', 'completed', 'abandoned', 'paused']), // Include 'paused' for legacy
          enteredAt: z.string().optional(), // Optional for legacy files with pausedAt instead
          exitedAt: z.string().optional(),
          pausedAt: z.string().optional(), // Legacy field
          resumedAt: z.string().optional(), // Legacy field
          currentPhase: z.string().optional(), // Some states track phase here
          completedPhases: z.array(z.string()).optional(), // Some states track this here
        }),
      )
      .default({}),

    // Timestamps
    startedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    workflowCompletedAt: z.string().optional(),

    // Session metadata (legacy - preserved for compatibility)
    branch: z.string().optional(),
    // beadsCreated supports both legacy (number[]) and new (object[]) formats
    beadsCreated: z
      .array(
        z.union([
          z.number(), // Legacy format: just bead ID
          z.object({
            // New format: phase → bead mapping with timestamp
            phaseId: z.string(),
            beadId: z.string(),
            createdAt: z.string(),
          }),
        ]),
      )
      .default([]),
    editedFiles: z.array(z.string()).default([]),
    ledger: z
      .object({
        corrections: z.array(z.string()).default([]),
        errors: z.array(z.string()).default([]),
        decisions: z.array(z.string()).default([]),
        discoveries: z.array(z.string()).default([]),
      })
      .optional(),

    // Flags (legacy - preserved for backwards compatibility with existing state files)
    todosWritten: z.boolean().optional(),
    todosWrittenAt: z.string().optional(),

    // One-off session (--tmp flag) - custom template not registered in modes.yaml
    isTemporary: z.boolean().optional(),

    // Spec path (for implementation mode)
    specPath: z.string().optional(),

    // Workflow directory (for task-based tracking)
    workflowDir: z.string().optional(),
  })
  .passthrough() // Allow extra fields from legacy state files

export type SessionState = z.infer<typeof SessionStateSchema>

/**
 * Entry action schema - what to do when entering a mode
 */
export const EntryActionSchema = z.object({
  check: z.string(), // Condition to check
  // biome-ignore lint/suspicious/noThenProperty: YAML config uses 'then' for readability
  then: z.string(), // Action to take
})

/**
 * Context signal schema - patterns that inform behavior
 */
export const ContextSignalSchema = z.object({
  pattern: z.string(), // What to look for
  inference: z.string(), // What it means
  action: z.string(), // What to do
})

/**
 * Never ask item schema
 */
export const NeverAskSchema = z.object({
  question: z.string(), // Question to avoid
  instead: z.string(), // What to do instead
})

/**
 * Behavior schema - how the agent should act when this mode is detected
 */
export const ModeBehaviorSchema = z.object({
  bias: z.enum(['act', 'ask', 'cautious']).optional(), // Default stance
  entry_actions: z.array(EntryActionSchema).optional(),
  context_signals: z.array(ContextSignalSchema).optional(),
  never_ask: z.array(NeverAskSchema).optional(),
  ok_to_ask: z.array(z.string()).optional(),
})

/**
 * Mode configuration schema - represents a mode definition from modes.yaml
 */
export const ModeConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  intent_keywords: z.array(z.string()).optional(),
  strong_signals: z.array(z.string()).optional(), // High-confidence keywords
  template: z.string(),
  workflow_prefix: z.string().optional(),
  phases: z.array(z.string()).optional(), // Deprecated: phases come from templates now
  category: z.enum([
    'planning',
    'implementation',
    'investigation',
    'management',
    'special',
    'system',
  ]),
  aliases: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
  redirect_to: z.string().optional(),
  micro_planning: z.boolean().optional(),
  issue_handling: z.enum(['required', 'none']).optional(), // How issues are handled on entry
  stop_conditions: z.array(z.string()).optional(), // Which checks to run before allowing exit
  behavior: ModeBehaviorSchema.optional(), // Behavioral guidance
})

export type ModeConfig = z.infer<typeof ModeConfigSchema>

/**
 * Global behavior schema - rules that apply across all modes
 */
export const GlobalBehaviorSchema = z.object({
  never_ask_globally: z.array(z.string()).optional(),
  ask_when: z.array(z.string()).optional(),
  inference: z.record(z.string()).optional(),
})

/**
 * modes.yaml root schema
 */
export const ModesConfigSchema = z.object({
  modes: z.record(ModeConfigSchema),
  red_flags: z
    .array(
      z.object({
        pattern: z.string(),
        correction: z.string(),
      }),
    )
    .optional(),
  categories: z
    .record(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  global_behavior: GlobalBehaviorSchema.optional(),
})

export type ModesConfig = z.infer<typeof ModesConfigSchema>
export type ModeBehavior = z.infer<typeof ModeBehaviorSchema>
