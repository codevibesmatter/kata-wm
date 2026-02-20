// packages/workflow-management/src/validation/phase-validator.ts
// Validation logic for template phases
import { type PhaseDefinition, templatePhasesSchema } from './schemas.js'

/**
 * Validation error with context about what failed
 */
export class PhaseValidationError extends Error {
  constructor(
    message: string,
    public readonly phaseId?: string,
    public readonly field?: string,
    public readonly templatePath?: string,
  ) {
    super(message)
    this.name = 'PhaseValidationError'
  }
}

/**
 * Result of validation - either success or failure with details
 */
export interface ValidationResult {
  valid: boolean
  errors: PhaseValidationError[]
}

/**
 * Validate phases from template YAML
 * Checks:
 * - Schema validation (required fields, types)
 * - Unique phase IDs
 * - Valid dependencies (all depends_on reference existing phases)
 * - Single container phase (max 1 with container: true)
 */
export function validatePhases(phases: unknown[], templatePath?: string): ValidationResult {
  const errors: PhaseValidationError[] = []

  // 1. Schema validation
  const parseResult = templatePhasesSchema.safeParse(phases)
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join('.')
      // Extract phase ID from path if present (e.g., "0.id" -> phase at index 0)
      const phaseIndex = Number.parseInt(issue.path[0]?.toString() ?? '', 10)
      const phaseId = !Number.isNaN(phaseIndex)
        ? (phases[phaseIndex] as Record<string, unknown>)?.id?.toString()
        : undefined

      errors.push(
        new PhaseValidationError(
          `${issue.message} at ${path}`,
          phaseId,
          issue.path[issue.path.length - 1]?.toString(),
          templatePath,
        ),
      )
    }
    return { valid: false, errors }
  }

  const validPhases = parseResult.data

  // 2. Check for duplicate phase IDs
  const seenIds = new Set<string>()
  for (const phase of validPhases) {
    if (seenIds.has(phase.id)) {
      errors.push(
        new PhaseValidationError(`Duplicate phase ID: ${phase.id}`, phase.id, 'id', templatePath),
      )
    }
    seenIds.add(phase.id)
  }

  // 3. Check dependencies reference existing phases
  for (const phase of validPhases) {
    if (phase.task_config?.depends_on) {
      for (const depId of phase.task_config.depends_on) {
        if (!seenIds.has(depId)) {
          errors.push(
            new PhaseValidationError(
              `Phase ${phase.id} depends on non-existent phase: ${depId}`,
              phase.id,
              'depends_on',
              templatePath,
            ),
          )
        }
      }
    }
  }

  // 4. Check for single container phase
  const containerPhases = validPhases.filter((p) => p.container === true)
  if (containerPhases.length > 1) {
    errors.push(
      new PhaseValidationError(
        `Multiple container phases found: ${containerPhases.map((p) => p.id).join(', ')}. Only one phase can be marked as container.`,
        undefined,
        'container',
        templatePath,
      ),
    )
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return '✅ All phases valid'
  }

  const lines = ['❌ Phase validation failed:', '']
  for (const error of result.errors) {
    const location = [
      error.phaseId && `phase: ${error.phaseId}`,
      error.field && `field: ${error.field}`,
      error.templatePath && `file: ${error.templatePath}`,
    ]
      .filter(Boolean)
      .join(', ')

    lines.push(`  • ${error.message}`)
    if (location) {
      lines.push(`    (${location})`)
    }
  }

  return lines.join('\n')
}

/**
 * Validate phases and throw if invalid
 * Use this for runtime validation in wm enter
 */
export function validatePhasesOrThrow(phases: unknown[], templatePath?: string): PhaseDefinition[] {
  const result = validatePhases(phases, templatePath)
  if (!result.valid) {
    const message = formatValidationErrors(result)
    throw new PhaseValidationError(message, undefined, undefined, templatePath)
  }

  // Re-parse to get typed result (we know it's valid now)
  return templatePhasesSchema.parse(phases)
}
