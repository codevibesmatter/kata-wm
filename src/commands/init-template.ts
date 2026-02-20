import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { findClaudeProjectDir } from '../session/lookup.js'

interface InitTemplateOptions {
  path: string
  name?: string
  mode?: string
  phases?: number
  withBeads?: boolean
}

/**
 * Generate a template file with boilerplate phases
 */
function generateTemplate(options: InitTemplateOptions): string {
  const templateName = options.name || basename(options.path, '.md')
  const mode = options.mode || templateName
  const phaseCount = options.phases || 3
  const withBeads = options.withBeads !== false

  const phases: string[] = []

  for (let i = 0; i < phaseCount; i++) {
    const phaseId = `p${i}`
    const phaseName = i === 0 ? 'Setup' : i === phaseCount - 1 ? 'Completion' : `Phase ${i}`

    if (withBeads) {
      const beadTitle = `${mode.toUpperCase()}: ${phaseName}`
      const labels = i === 0 ? 'phase, phase-0, setup' : `phase, phase-${i}`
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
    } else {
      phases.push(`  - id: ${phaseId}
    name: "${phaseName}"`)
    }
  }

  return `---
id: ${mode}
name: "${templateName}"
description: "Custom workflow template"
mode: ${mode}

phases:
${phases.join('\n')}
---

# ${templateName} Workflow

This is a custom workflow template with ${phaseCount} phases.

## Overview

Describe the purpose of this workflow here.

## Phase Guide

${Array.from({ length: phaseCount }, (_, i) => {
  const phaseName = i === 0 ? 'Setup' : i === phaseCount - 1 ? 'Completion' : `Phase ${i}`
  return `### P${i}: ${phaseName}

- Describe what happens in this phase
- List key activities or deliverables
`
}).join('\n')}

## Stop Conditions

Define the conditions that must be met before this workflow can be considered complete:

- [ ] All phase beads are closed
- [ ] Key deliverables are committed
- [ ] (Add your conditions here)
`
}

function parseArgs(args: string[]): InitTemplateOptions & { help?: boolean } {
  const result: InitTemplateOptions & { help?: boolean } = { path: '' }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg.startsWith('--name=')) {
      result.name = arg.slice('--name='.length)
    } else if (arg.startsWith('--mode=')) {
      result.mode = arg.slice('--mode='.length)
    } else if (arg.startsWith('--phases=')) {
      const phases = Number.parseInt(arg.slice('--phases='.length), 10)
      if (!Number.isNaN(phases) && phases > 0) {
        result.phases = phases
      }
    } else if (arg === '--no-beads') {
      result.withBeads = false
    } else if (!arg.startsWith('--')) {
      result.path = arg
    }
  }

  return result
}

function showHelp(): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`
Usage: wm init-template <path> [options]

Create a new workflow template file with boilerplate phases.

Arguments:
  <path>              Path where template will be created (e.g., /tmp/my-workflow.md)

Options:
  --name=NAME         Template display name (default: derived from filename)
  --mode=MODE         Mode identifier (default: derived from filename)
  --phases=N          Number of phases to generate (default: 3)
  --no-beads          Don't include bead definitions in phases
  --help, -h          Show this help message

Examples:
  wm init-template /tmp/my-workflow.md
  wm init-template packages/workflow-management/templates/sprint-review.md --phases=5
  wm init-template /tmp/simple.md --no-beads --phases=2
  wm init-template ./custom.md --name="Custom Workflow" --mode=custom

The generated template can be used with:
  wm enter --template=/tmp/my-workflow.md
`)
}

export async function initTemplateCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  if (parsed.help) {
    showHelp()
    return
  }

  if (!parsed.path) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Template path is required')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Usage: wm init-template <path> [options]')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Examples:')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm init-template /tmp/my-workflow.md')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm init-template packages/workflow-management/templates/custom.md --phases=5')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Run "wm init-template --help" for more options.')
    process.exit(1)
  }

  // Resolve path
  const projectDir = findClaudeProjectDir()
  const templatePath = parsed.path.startsWith('/')
    ? parsed.path
    : resolve(projectDir || process.cwd(), parsed.path)

  // Ensure .md extension
  const finalPath = templatePath.endsWith('.md') ? templatePath : `${templatePath}.md`

  // Check if file already exists
  if (existsSync(finalPath)) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: File already exists: ${finalPath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('To overwrite, delete the file first or choose a different path.')
    process.exit(1)
  }

  // Create directory if needed
  const dir = dirname(finalPath)
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`Created directory: ${dir}`)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(`Error: Cannot create directory: ${dir}`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }

  // Generate template content
  const content = generateTemplate({
    path: finalPath,
    name: parsed.name,
    mode: parsed.mode,
    phases: parsed.phases,
    withBeads: parsed.withBeads,
  })

  // Write file
  try {
    writeFileSync(finalPath, content)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`✅ Created template: ${finalPath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('Next steps:')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  1. Edit the template to customize phases and content`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  2. Validate: wm validate-template ${finalPath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  3. Use it:   wm enter --template=${finalPath}`)
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Cannot write file: ${finalPath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
