import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { findClaudeProjectDir } from '../session/lookup.js'
import { loadWmConfig } from '../config/wm-config.js'

interface ValidationResult {
  valid: boolean
  specPath: string
  issueNumber?: number
  phases: number
  totalTasks: number
  errors: string[]
  warnings: string[]
}

/**
 * Find spec file by issue number
 */
function findSpecFile(issueNum: number): string | null {
  const projectDir = findClaudeProjectDir()
  if (!projectDir) return null

  const specsDir = resolve(projectDir, loadWmConfig().spec_path ?? 'planning/specs')
  if (!existsSync(specsDir)) return null

  try {
    const files = readdirSync(specsDir)
    const pattern = new RegExp(`^${issueNum}-.*\\.md$`)
    const match = files.find((f) => pattern.test(f))
    return match ? resolve(specsDir, match) : null
  } catch {
    return null
  }
}

/**
 * Parse and validate spec YAML frontmatter
 */
function validateSpec(specPath: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    specPath,
    phases: 0,
    totalTasks: 0,
    errors: [],
    warnings: [],
  }

  // Check file exists
  if (!existsSync(specPath)) {
    result.valid = false
    result.errors.push(`Spec file not found: ${specPath}`)
    return result
  }

  const content = readFileSync(specPath, 'utf-8')

  // Check YAML frontmatter exists
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    result.valid = false
    result.errors.push('No YAML frontmatter found (must start with --- and end with ---)')
    return result
  }

  const yaml = match[1]

  // Parse github_issue
  const issueMatch = yaml.match(/github_issue:\s*(\d+)/)
  if (issueMatch) {
    result.issueNumber = Number.parseInt(issueMatch[1], 10)
  } else {
    result.warnings.push('No github_issue field in frontmatter')
  }

  // Check for phases section
  const phasesMatch = yaml.match(/phases:\s*\n([\s\S]*?)(?:\n[a-z_]+:|\n---|\n$|$)/i)
  if (!phasesMatch) {
    result.warnings.push('No phases section found in frontmatter')
    return result
  }

  const phasesSection = phasesMatch[1]

  // Parse each phase block
  const phaseBlocks = `\n${phasesSection}`.split(/\n {2}- id:/).slice(1)

  if (phaseBlocks.length === 0) {
    result.errors.push(
      'phases section exists but contains no phases (each phase needs "  - id: pN")',
    )
    result.valid = false
    return result
  }

  const seenIds = new Set<string>()

  for (let phaseIdx = 0; phaseIdx < phaseBlocks.length; phaseIdx++) {
    const block = phaseBlocks[phaseIdx]
    const lines = `id:${block}`.split('\n')

    let phaseId = ''
    let phaseName = ''
    let inTasks = false
    let taskCount = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const indent = line.length - line.trimStart().length

      if (indent <= 4 && trimmed.startsWith('id:')) {
        phaseId = trimmed.slice(3).trim()
      } else if (indent <= 4 && trimmed.startsWith('name:')) {
        phaseName = trimmed.slice(5).trim().replace(/^"|"$/g, '')
      } else if (trimmed === 'tasks:') {
        inTasks = true
      } else if ((inTasks && trimmed.startsWith('- "')) || (inTasks && trimmed.startsWith("- '"))) {
        // Task is a simple string like: - "Task description"
        taskCount++
      }
    }

    // Validate phase
    if (!phaseId) {
      result.errors.push(`Phase ${phaseIdx + 1}: Missing id field`)
      result.valid = false
      continue
    }

    if (seenIds.has(phaseId)) {
      result.errors.push(`Phase ${phaseIdx + 1}: Duplicate id "${phaseId}"`)
      result.valid = false
    }
    seenIds.add(phaseId)

    if (!phaseName) {
      result.warnings.push(`Phase ${phaseId}: Missing name field`)
    }

    result.phases++
    result.totalTasks += taskCount
  }

  // Enforce: phases must have tasks for implementation mode to work
  if (result.valid && result.totalTasks === 0 && result.phases > 0) {
    result.errors.push(
      'Phases exist but no tasks defined. Each phase needs a tasks array like:\n' +
        '    - id: phase-1\n' +
        '      name: "Phase Name"\n' +
        '      tasks:\n' +
        '        - "First task description"\n' +
        '        - "Second task description"',
    )
    result.valid = false
  }

  return result
}

function parseArgs(args: string[]): { issue?: number; path?: string } {
  const result: { issue?: number; path?: string } = {}

  for (const arg of args) {
    if (arg.startsWith('--issue=')) {
      result.issue = Number.parseInt(arg.slice(8), 10)
    } else if (!arg.startsWith('--') && arg.endsWith('.md')) {
      result.path = arg
    }
  }

  return result
}

export async function validateSpecCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  let specPath: string | null = null

  if (parsed.path) {
    specPath = resolve(parsed.path)
  } else if (parsed.issue) {
    specPath = findSpecFile(parsed.issue)
    if (!specPath) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(`No spec file found for issue #${parsed.issue}`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error('Expected: planning/specs/{issue}-*.md')
      process.exit(1)
    }
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Usage: wm validate-spec --issue=123')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('   or: wm validate-spec path/to/spec.md')
    process.exit(1)
  }

  const result = validateSpec(specPath)

  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('')
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Spec: ${result.specPath}`)
  if (result.issueNumber) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`Issue: #${result.issueNumber}`)
  }
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Phases: ${result.phases}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`Total tasks: ${result.totalTasks}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('')

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
    console.log('✅ Spec is valid for implementation mode')
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('❌ Spec has errors that will prevent implementation mode from working')
    process.exit(1)
  }
}
