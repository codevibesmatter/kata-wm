// Type definitions for YAML frontmatter structures
// Re-export validated types from validation module
export type {
  PhaseDefinition,
  PhaseStep,
  SubphasePattern,
} from '../validation/schemas.js'

import type { PhaseDefinition } from '../validation/schemas.js'

/**
 * Template YAML frontmatter structure
 */
export interface TemplateYaml {
  id?: string
  name?: string
  description?: string
  mode?: string
  phases?: PhaseDefinition[]
  global_conditions?: string[]
  workflow_id_format?: string
}

/**
 * Bead in spec format (legacy)
 */
export interface SpecBead {
  title: string
  type?: string
  labels?: string[]
  depends_on?: number[]
}

/**
 * Phase definition in spec YAML
 */
export interface SpecPhase {
  id: string
  name?: string
  tasks?: string[]
  beads?: SpecBead[] // Legacy format
}

/**
 * Spec YAML frontmatter structure
 */
export interface SpecYaml {
  github_issue?: number
  title?: string
  type?: string
  status?: string
  phases?: SpecPhase[]
}
