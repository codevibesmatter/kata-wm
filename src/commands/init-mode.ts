import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir } from '../session/lookup.js'

interface InitModeOptions {
  name: string
  displayName?: string
  description?: string
  category?: string
  phases?: number
  workflowPrefix?: string
  keywords?: string[]
  aliases?: string[]
}

const VALID_CATEGORIES = ['planning', 'implementation', 'investigation', 'management', 'special']

/**
 * Generate template content for a new mode
 */
function generateModeTemplate(options: InitModeOptions): string {
  const modeName = options.name
  const displayName = options.displayName || modeName.charAt(0).toUpperCase() + modeName.slice(1)
  const phaseCount = options.phases || 3
  const prefix = options.workflowPrefix || modeName.substring(0, 2).toUpperCase()

  const phases: string[] = []
  const phaseNames: string[] = []

  for (let i = 0; i < phaseCount; i++) {
    const phaseId = `p${i}`
    const phaseName = i === 0 ? 'Setup' : i === phaseCount - 1 ? 'Complete' : `Phase ${i}`
    phaseNames.push(phaseName.toLowerCase().replace(/\s+/g, '-'))

    const beadTitle = `${prefix}: ${phaseName}`
    const labels = `phase, phase-${i}`
    const dependsOn = i > 0 ? `p${i - 1}` : ''

    phases.push(`  - id: ${phaseId}
    name: "${phaseName}"
    bead:
      title: "${beadTitle}"
      labels: [${labels}]${
        dependsOn
          ? `
      depends_on: [${dependsOn}]`
          : ''
      }`)
  }

  return `---
id: ${modeName}
name: "${displayName}"
description: "${options.description || `Custom ${displayName} workflow`}"
mode: ${modeName}
workflow_prefix: "${prefix}"

phases:
${phases.join('\n')}
---

# ${displayName} Mode

${options.description || `This is the ${displayName} workflow mode.`}

## Overview

Describe the purpose and goals of this mode here.

## Phase Guide

${Array.from({ length: phaseCount }, (_, i) => {
  const phaseName = i === 0 ? 'Setup' : i === phaseCount - 1 ? 'Complete' : `Phase ${i}`
  return `### P${i}: ${phaseName}

**Goal:** Define the goal of this phase

**Activities:**
- Activity 1
- Activity 2

**Exit Criteria:**
- Criteria that must be met before advancing
`
}).join('\n')}

## Stop Conditions

Before exiting this mode:

- [ ] All phase beads are closed
- [ ] Key deliverables are committed
- [ ] (Add mode-specific conditions)

## Tips

- Tip 1 for using this mode effectively
- Tip 2
`
}

/**
 * Generate YAML entry for modes.yaml
 */
function generateModeYamlEntry(options: InitModeOptions): Record<string, unknown> {
  const modeName = options.name
  const displayName = options.displayName || modeName.charAt(0).toUpperCase() + modeName.slice(1)
  const prefix = options.workflowPrefix || modeName.substring(0, 2).toUpperCase()

  const entry: Record<string, unknown> = {
    name: displayName,
    description: options.description || `Custom ${displayName} workflow`,
    intent_keywords: options.keywords || [`${modeName}`],
    template: `${modeName}.md`,
    workflow_prefix: prefix,
    category: options.category || 'special',
  }

  if (options.aliases && options.aliases.length > 0) {
    entry.aliases = options.aliases
  }

  return entry
}

function parseArgs(args: string[]): InitModeOptions & { help?: boolean; dryRun?: boolean } {
  const result: InitModeOptions & { help?: boolean; dryRun?: boolean } = { name: '' }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--dry-run') {
      result.dryRun = true
    } else if (arg.startsWith('--display-name=')) {
      result.displayName = arg.slice('--display-name='.length)
    } else if (arg.startsWith('--description=')) {
      result.description = arg.slice('--description='.length)
    } else if (arg.startsWith('--category=')) {
      result.category = arg.slice('--category='.length)
    } else if (arg.startsWith('--phases=')) {
      const phases = Number.parseInt(arg.slice('--phases='.length), 10)
      if (!Number.isNaN(phases) && phases > 0) {
        result.phases = phases
      }
    } else if (arg.startsWith('--prefix=')) {
      result.workflowPrefix = arg.slice('--prefix='.length)
    } else if (arg.startsWith('--keywords=')) {
      result.keywords = arg
        .slice('--keywords='.length)
        .split(',')
        .map((k) => k.trim())
    } else if (arg.startsWith('--aliases=')) {
      result.aliases = arg
        .slice('--aliases='.length)
        .split(',')
        .map((a) => a.trim())
    } else if (!arg.startsWith('--')) {
      result.name = arg
    }
  }

  return result
}

function showHelp(): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`
Usage: wm init-mode <name> [options]

Create a new mode with template and register it in modes.yaml.

This creates:
  1. Template file at packages/workflow-management/templates/<name>.md
  2. Entry in packages/workflow-management/modes.yaml

Arguments:
  <name>                    Mode identifier (kebab-case, e.g., "code-review")

Options:
  --display-name=NAME       Human-readable name (default: capitalized name)
  --description=DESC        Mode description
  --category=CATEGORY       One of: ${VALID_CATEGORIES.join(', ')} (default: special)
  --phases=N                Number of phases (default: 3)
  --prefix=PREFIX           Workflow ID prefix (default: first 2 chars uppercase)
  --keywords=K1,K2          Intent keywords for auto-detection (comma-separated)
  --aliases=A1,A2           Aliases for the mode (comma-separated)
  --dry-run                 Preview what would be created
  --help, -h                Show this help message

Examples:
  wm init-mode code-review
  wm init-mode sprint-planning --phases=5 --category=planning
  wm init-mode quick-fix --prefix=QF --aliases=qf,fast-fix
  wm init-mode code-review --dry-run

After creation:
  wm enter code-review                    # Use the new mode
  wm validate-template packages/workflow-management/templates/code-review.md
`)
}

export async function initModeCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  if (parsed.help) {
    showHelp()
    return
  }

  if (!parsed.name) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Mode name is required')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Usage: wm init-mode <name> [options]')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Examples:')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm init-mode code-review')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm init-mode sprint-planning --phases=5')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Run "wm init-mode --help" for more options.')
    process.exit(1)
  }

  // Validate mode name (kebab-case)
  if (!/^[a-z][a-z0-9-]*$/.test(parsed.name)) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Mode name must be kebab-case (lowercase letters, numbers, hyphens)')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`  Got: ${parsed.name}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  Valid examples: code-review, sprint-planning, quick-fix')
    process.exit(1)
  }

  // Validate category
  if (parsed.category && !VALID_CATEGORIES.includes(parsed.category)) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Invalid category: ${parsed.category}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`  Valid categories: ${VALID_CATEGORIES.join(', ')}`)
    process.exit(1)
  }

  const projectDir = findClaudeProjectDir()
  if (!projectDir) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Could not find .claude directory')
    process.exit(1)
  }

  // Always write to project-level paths (npm installs have read-only package paths)
  const workflowsDir = resolve(projectDir, '.claude', 'workflows')
  const modesYamlPath = resolve(workflowsDir, 'modes.yaml')
  const templatesDir = resolve(workflowsDir, 'templates')
  const templatePath = resolve(templatesDir, `${parsed.name}.md`)

  // Check if mode already exists
  if (existsSync(templatePath)) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Template already exists: ${templatePath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('To modify an existing mode, edit the template directly.')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('To replace, delete the existing template first.')
    process.exit(1)
  }

  // Check if mode is already in modes.yaml
  if (existsSync(modesYamlPath)) {
    const modesContent = readFileSync(modesYamlPath, 'utf-8')
    const modesYaml = jsYaml.load(modesContent, { schema: jsYaml.CORE_SCHEMA }) as
      | Record<string, unknown>
      | undefined
    if ((modesYaml?.modes as Record<string, unknown> | undefined)?.[parsed.name]) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(`Error: Mode "${parsed.name}" already exists in modes.yaml`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error('')
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error('To modify, edit packages/workflow-management/modes.yaml directly.')
      process.exit(1)
    }
  }

  const templateContent = generateModeTemplate(parsed)
  const modeEntry = generateModeYamlEntry(parsed)

  if (parsed.dryRun) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('=== DRY RUN ===')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`Would create template: ${templatePath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('Template content preview (first 30 lines):')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('---')
    const lines = templateContent.split('\n').slice(0, 30)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(lines.join('\n'))
    if (templateContent.split('\n').length > 30) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log('... (truncated)')
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('---')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`Would add to modes.yaml:`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('---')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  ${parsed.name}:`)
    for (const [key, value] of Object.entries(modeEntry)) {
      if (Array.isArray(value)) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log(`    ${key}:`)
        for (const item of value) {
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log(`      - ${item}`)
        }
      } else {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log(`    ${key}: ${JSON.stringify(value)}`)
      }
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('---')
    return
  }

  // Create templates directory if needed
  if (!existsSync(templatesDir)) {
    mkdirSync(templatesDir, { recursive: true })
  }

  // Write template file
  try {
    writeFileSync(templatePath, templateContent)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`✅ Created template: ${templatePath}`)
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Cannot write template: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  // Update modes.yaml
  try {
    let modesYaml: Record<string, unknown> = { modes: {}, categories: {} }

    if (existsSync(modesYamlPath)) {
      const content = readFileSync(modesYamlPath, 'utf-8')
      modesYaml = (jsYaml.load(content, { schema: jsYaml.CORE_SCHEMA }) as
        | Record<string, unknown>
        | undefined) || {
        modes: {},
        categories: {},
      }
    }

    if (!modesYaml.modes) {
      modesYaml.modes = {}
    }
    // Add the new mode
    ;(modesYaml.modes as Record<string, unknown>)[parsed.name] = modeEntry

    // Write back
    const yamlStr = jsYaml.dump(modesYaml)

    writeFileSync(modesYamlPath, yamlStr)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`✅ Added to modes.yaml: ${parsed.name}`)
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Cannot update modes.yaml: ${err instanceof Error ? err.message : err}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Template was created but mode was not registered.')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('You can manually add it to packages/workflow-management/modes.yaml')
    process.exit(1)
  }

  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('')
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('Next steps:')
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`  1. Edit template: ${templatePath}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`  2. Use the mode: wm enter ${parsed.name}`)
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`  3. Or with dry-run: wm enter ${parsed.name} --dry-run`)
}
