// Template parsing utilities for enter command
import { resolveTemplatePath } from '../../session/lookup.js'
import {
  validatePhases,
  formatValidationErrors,
  type PhaseDefinition,
  type SubphasePattern,
} from '../../validation/index.js'
import { parseYamlFrontmatter, type TemplateYaml } from '../../yaml/index.js'
import type { PhaseTitle } from './guidance.js'

/**
 * Parse YAML frontmatter from template file
 * Uses js-yaml via yaml module
 */
export function parseTemplateYaml(templatePath: string): TemplateYaml | null {
  return parseYamlFrontmatter<TemplateYaml>(templatePath)
}

/**
 * Get phase titles from template for TodoWrite context
 */
export function getPhaseTitlesFromTemplate(templatePath: string): PhaseTitle[] {
  const fullTemplatePath = resolveTemplatePath(templatePath)

  const template = parseTemplateYaml(fullTemplatePath)
  if (!template?.phases?.length) return []

  return template.phases
    .filter((p) => p.task_config?.title)
    .map((p) => ({
      id: p.id,
      title: p.task_config!.title,
    }))
}

/**
 * Parse and validate template phases
 * Returns validated phases or null if parsing/validation fails
 */
export function parseAndValidateTemplatePhases(templatePath: string): PhaseDefinition[] | null {
  const fullTemplatePath = resolveTemplatePath(templatePath)

  const template = parseTemplateYaml(fullTemplatePath)
  if (!template?.phases?.length) return null

  // Validate phases
  const validationResult = validatePhases(template.phases, fullTemplatePath)
  if (!validationResult.valid) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(formatValidationErrors(validationResult))
    return null
  }

  // Return phases converted to PhaseDefinition type (include subphase_pattern for container phases)
  return template.phases.map((p) => ({
    id: p.id,
    name: p.name || '',
    task_config: p.task_config,
    container: (p as Record<string, unknown>).container as boolean | undefined,
    subphase_pattern: (p as Record<string, unknown>).subphase_pattern as
      | SubphasePattern[]
      | undefined,
  }))
}
