// packages/workflow-management/src/validation/schemas.ts
// Zod schemas for validating template phase configurations
import { z } from 'zod'

/**
 * Schema for task configuration within a phase
 */
export const phaseTaskConfigSchema = z.object({
  title: z.string().min(1, 'Task config title cannot be empty'),
  labels: z.array(z.string()).optional().default([]),
  depends_on: z.array(z.string()).optional(),
})

/**
 * Schema for an external agent step configuration.
 * When a step has an `agent` field, the step runner invokes
 * the specified provider with the named prompt and assembled context.
 */
export const agentStepConfigSchema = z.object({
  /** Provider name: 'claude' | 'gemini' | 'codex' or a wm.yaml variable like '${providers.default}' */
  provider: z.string().min(1, 'Agent provider cannot be empty'),
  /** Override model for the provider. Optional — uses provider default. */
  model: z.string().optional(),
  /** Prompt template name (loads from project .kata/prompts/ or batteries/prompts/{name}.md) */
  prompt: z.string().min(1, 'Agent prompt name cannot be empty'),
  /** Named context sources to assemble into the prompt */
  context: z.array(z.string()).optional(),
  /** Output artifact path (relative to project root). Supports {date} placeholder. */
  output: z.string().optional(),
  /** If true, blocks next step until score meets threshold */
  gate: z.boolean().optional(),
  /** Minimum score (0-100) to pass the gate. Default: 75. */
  threshold: z.number().min(0).max(100).optional(),

  // ── Agent capability options (forwarded to provider.run) ──

  /** Tools the agent can use. Default: [] (text-only, no tools). */
  allowed_tools: z.array(z.string()).optional(),
  /** Max agentic turns. Default: 3 (review/judge mode). */
  max_turns: z.number().min(1).optional(),
  /** Execution timeout in seconds. Default: 300 (5 min). */
  timeout: z.number().min(1).optional(),
})

/**
 * Schema for a step within a phase
 * Steps are individual trackable units within a phase (e.g., interview rounds)
 */
export const phaseStepSchema = z.object({
  id: z.string().min(1, 'Step ID cannot be empty'),
  title: z.string().min(1, 'Step title cannot be empty'),
  instruction: z.string().optional(),
  agent: agentStepConfigSchema.optional(),
})

/**
 * Schema for subphase pattern (used by container phases)
 * Defines what tasks to create for each spec phase
 */
export const subphasePatternSchema = z.object({
  id_suffix: z.string().min(1, 'Subphase ID suffix cannot be empty'),
  title_template: z.string().min(1, 'Title template cannot be empty'),
  todo_template: z.string().min(1, 'Todo template cannot be empty'),
  active_form: z.string().min(1, 'Active form cannot be empty'),
  labels: z.array(z.string()).default([]),
  depends_on_previous: z.boolean().optional(),
  instruction: z.string().optional(),
  agent: agentStepConfigSchema.optional(),
})

/**
 * Schema for a single phase definition
 * Phase IDs must match pattern: p0, p1, p2, p2.1, p2.2 (subphases), or p2-name (named subphases)
 */
export const phaseSchema = z.object({
  id: z.string().regex(/^p\d+(\.\d+|-[a-z][a-z0-9-]*)?$/, 'Phase ID must match pattern: p0, p1, p2, p2.1, or p2-name'),
  name: z.string().min(1, 'Phase name cannot be empty'),
  task_config: phaseTaskConfigSchema.optional(),
  steps: z.array(phaseStepSchema).optional(), // Individual trackable units within phase (e.g., interview rounds)
  container: z.boolean().optional(), // Marks phase that accepts spec content phases
  subphase_pattern: z.union([z.string(), z.array(subphasePatternSchema)]).optional(), // Name reference or inline array
})

/**
 * Schema for array of phases in template
 */
export const templatePhasesSchema = z.array(phaseSchema)

/**
 * Schema for template YAML frontmatter
 */
export const templateYamlSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  mode: z.string().optional(),
  phases: templatePhasesSchema.optional(),
  global_conditions: z.array(z.string()).optional(),
  workflow_id_format: z.string().optional(),
})

/**
 * Schema for evidence types in modes.yaml
 */
export const evidenceTypeSchema = z.object({
  description: z.string(),
  pattern: z.string().optional(),
  command: z.string().optional(),
  gate: z.string().optional(),
  format: z.string().optional(),
  default: z.boolean().optional(),
})

/**
 * Schema for all evidence types
 */
export const evidenceTypesSchema = z.record(z.string(), evidenceTypeSchema)

// Type exports
export type AgentStepConfig = z.infer<typeof agentStepConfigSchema>
export type PhaseTaskConfig = z.infer<typeof phaseTaskConfigSchema>
export type PhaseStep = z.infer<typeof phaseStepSchema>
export type SubphasePattern = z.infer<typeof subphasePatternSchema>
export type PhaseDefinition = z.infer<typeof phaseSchema>
export type TemplateYaml = z.infer<typeof templateYamlSchema>
export type EvidenceType = z.infer<typeof evidenceTypeSchema>
export type EvidenceTypes = z.infer<typeof evidenceTypesSchema>
