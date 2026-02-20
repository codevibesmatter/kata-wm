import { existsSync, readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { findClaudeProjectDir } from '../session/lookup.js'
import { validatePhases } from '../validation/index.js'

interface TemplateValidationResult {
  valid: boolean
  templatePath: string
  templateName: string
  phases: number
  phasesWithBeads: number
  hasContainer: boolean
  errors: string[]
  warnings: string[]
  phaseDetails: Array<{
    id: string
    name: string
    hasBeads: boolean
    dependencies: string[]
  }>
}

/**
 * Parse YAML frontmatter from template file
 */
function parseTemplateFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  // Simple YAML parsing for common fields
  const yaml = match[1]
  const result: Record<string, unknown> = {}

  // Parse top-level string fields
  const stringFields = ['id', 'name', 'description', 'mode', 'promptFile', 'workflow_prefix']
  for (const field of stringFields) {
    const fieldMatch = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
    if (fieldMatch) {
      result[field] = fieldMatch[1].trim().replace(/^["']|["']$/g, '')
    }
  }

  // Parse phases array
  const phasesMatch = yaml.match(/phases:\s*\n([\s\S]*?)(?:\n[a-z_]+:|\n---|\n$|$)/i)
  if (phasesMatch) {
    result.phases = parsePhasesSection(phasesMatch[1])
  }

  return result
}

/**
 * Parse phases section from YAML
 */
function parsePhasesSection(phasesSection: string): unknown[] {
  const phases: Record<string, unknown>[] = []

  // Split on phase boundaries
  const rawBlocks = phasesSection.split(/\n {2}- id:/)
  const phaseBlocks = phasesSection.trimStart().startsWith('- id:')
    ? rawBlocks.map((b, i) => (i === 0 ? b.replace(/^ {2}- id:/, '') : b))
    : rawBlocks.slice(1)

  for (const block of phaseBlocks) {
    const lines = `id:${block}`.split('\n')
    const phase: Record<string, unknown> = {}

    let inBead = false
    let beadObj: Record<string, unknown> = {}

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = line.length - line.trimStart().length

      if (trimmed.startsWith('id:')) {
        phase.id = trimmed.slice(3).trim()
      } else if (trimmed.startsWith('name:')) {
        phase.name = trimmed
          .slice(5)
          .trim()
          .replace(/^["']|["']$/g, '')
      } else if (trimmed.startsWith('container:')) {
        phase.container = trimmed.slice(10).trim() === 'true'
      } else if (trimmed === 'bead:') {
        inBead = true
        beadObj = {}
      } else if (inBead && indent >= 6) {
        if (trimmed.startsWith('title:')) {
          beadObj.title = trimmed
            .slice(6)
            .trim()
            .replace(/^["']|["']$/g, '')
        } else if (trimmed.startsWith('labels:')) {
          const labelsStr = trimmed.slice(7).trim()
          if (labelsStr.startsWith('[')) {
            beadObj.labels = labelsStr
              .slice(1, -1)
              .split(',')
              .map((s) => s.trim())
          }
        } else if (trimmed.startsWith('depends_on:')) {
          const depsStr = trimmed.slice(11).trim()
          if (depsStr.startsWith('[')) {
            beadObj.depends_on = depsStr
              .slice(1, -1)
              .split(',')
              .map((s) => s.trim())
          }
        }
      } else if (indent <= 4 && inBead) {
        // Exiting bead section
        if (Object.keys(beadObj).length > 0) {
          phase.bead = beadObj
        }
        inBead = false
      }
    }

    // Handle case where bead section ends at end of phase
    if (inBead && Object.keys(beadObj).length > 0) {
      phase.bead = beadObj
    }

    if (phase.id) {
      phases.push(phase)
    }
  }

  return phases
}

/**
 * Validate a template file
 */
function validateTemplate(templatePath: string): TemplateValidationResult {
  const result: TemplateValidationResult = {
    valid: true,
    templatePath,
    templateName: basename(templatePath, '.md'),
    phases: 0,
    phasesWithBeads: 0,
    hasContainer: false,
    errors: [],
    warnings: [],
    phaseDetails: [],
  }

  // Check file exists
  if (!existsSync(templatePath)) {
    result.valid = false
    result.errors.push(`Template file not found: ${templatePath}`)
    return result
  }

  const content = readFileSync(templatePath, 'utf-8')

  // Parse frontmatter
  const frontmatter = parseTemplateFrontmatter(content)
  if (!frontmatter) {
    result.valid = false
    result.errors.push('No YAML frontmatter found (must start with --- and end with ---)')
    return result
  }

  // Check for required fields
  if (!frontmatter.id) {
    result.warnings.push('Missing "id" field in frontmatter')
  }
  if (!frontmatter.name) {
    result.warnings.push('Missing "name" field in frontmatter')
  }
  if (!frontmatter.mode) {
    result.warnings.push('Missing "mode" field in frontmatter')
  }

  // Check for phases
  const phases = frontmatter.phases as unknown[]
  if (!phases || !Array.isArray(phases) || phases.length === 0) {
    result.warnings.push('No phases defined in frontmatter')
    return result
  }

  // Use validation infrastructure
  const validationResult = validatePhases(phases, templatePath)
  if (!validationResult.valid) {
    result.valid = false
    for (const error of validationResult.errors) {
      result.errors.push(error.message)
    }
  }

  // Collect phase details
  result.phases = phases.length
  for (const phase of phases as Record<string, unknown>[]) {
    const phaseId = (phase.id as string) || 'unknown'
    const phaseName = (phase.name as string) || ''
    const bead = phase.bead as Record<string, unknown> | undefined
    const hasBead = bead && typeof bead.title === 'string'

    if (hasBead) {
      result.phasesWithBeads++
    }

    if (phase.container === true) {
      result.hasContainer = true
    }

    result.phaseDetails.push({
      id: phaseId,
      name: phaseName,
      hasBeads: !!hasBead,
      dependencies: (bead?.depends_on as string[]) || [],
    })
  }

  // Warnings for phases without beads
  for (const detail of result.phaseDetails) {
    if (!detail.hasBeads) {
      result.warnings.push(
        `Phase ${detail.id}: No bead definition (won't create bead when entering mode)`,
      )
    }
  }

  return result
}

function parseArgs(args: string[]): { path?: string; json?: boolean } {
  const result: { path?: string; json?: boolean } = {}

  for (const arg of args) {
    if (arg === '--json') {
      result.json = true
    } else if (!arg.startsWith('--')) {
      result.path = arg
    }
  }

  return result
}

export async function validateTemplateCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  if (!parsed.path) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Usage: wm validate-template <path-to-template.md> [--json]')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Examples:')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm validate-template packages/workflow-management/templates/task.md')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm validate-template /tmp/my-custom-template.md --json')
    process.exit(1)
  }

  const projectDir = findClaudeProjectDir()
  const templatePath = parsed.path.startsWith('/')
    ? parsed.path
    : resolve(projectDir || process.cwd(), parsed.path)

  const result = validateTemplate(templatePath)

  if (parsed.json) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(result, null, 2))
    if (!result.valid) {
      process.exit(1)
    }
    return
  }

  // Human-readable output
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('')
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Template: ${result.templatePath}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Name: ${result.templateName}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Phases: ${result.phases} (${result.phasesWithBeads} with beads)`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Has container phase: ${result.hasContainer ? 'yes' : 'no'}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('')

  if (result.phaseDetails.length > 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('PHASES:')
    for (const phase of result.phaseDetails) {
      const deps =
        phase.dependencies.length > 0 ? ` (depends on: ${phase.dependencies.join(', ')})` : ''
      const beadIndicator = phase.hasBeads ? '✓' : '○'
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`  ${beadIndicator} ${phase.id}: ${phase.name}${deps}`)
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
  }

  if (result.errors.length > 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('ERRORS:')
    for (const err of result.errors) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`  ❌ ${err}`)
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
  }

  if (result.warnings.length > 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('WARNINGS:')
    for (const warn of result.warnings) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`  ⚠️  ${warn}`)
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
  }

  if (result.valid) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('✅ Template is valid for use with wm enter --template=')
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('❌ Template has errors that must be fixed before use')
    process.exit(1)
  }
}
