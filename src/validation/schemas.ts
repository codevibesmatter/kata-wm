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
 * Schema for a step within a phase
 * Steps are individual trackable units within a phase (e.g., interview rounds)
 */
export const phaseStepSchema = z.object({
  id: z.string().min(1, 'Step ID cannot be empty'),
  title: z.string().min(1, 'Step title cannot be empty'),
  instruction: z.string().optional(),
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
})

/**
 * Schema for a single phase definition
 * Phase IDs must match pattern: p0, p1, p2, or p2.1, p2.2 (subphases)
 */
export const phaseSchema = z.object({
  id: z.string().regex(/^p\d+(\.\d+)?$/, 'Phase ID must match pattern: p0, p1, p2, or p2.1, p2.2'),
  name: z.string().min(1, 'Phase name cannot be empty'),
  task_config: phaseTaskConfigSchema.optional(),
  steps: z.array(phaseStepSchema).optional(), // Individual trackable units within phase (e.g., interview rounds)
  container: z.boolean().optional(), // Marks phase that accepts spec content phases
  subphase_pattern: z.array(subphasePatternSchema).optional(), // For container phases: what tasks to create per spec phase
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
export type PhaseTaskConfig = z.infer<typeof phaseTaskConfigSchema>
export type PhaseStep = z.infer<typeof phaseStepSchema>
export type SubphasePattern = z.infer<typeof subphasePatternSchema>
export type PhaseDefinition = z.infer<typeof phaseSchema>
export type TemplateYaml = z.infer<typeof templateYamlSchema>
export type EvidenceType = z.infer<typeof evidenceTypeSchema>
export type EvidenceTypes = z.infer<typeof evidenceTypesSchema>
