import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir } from '../session/lookup.js'
import { validatePhases } from '../validation/index.js'

interface RegisterModeOptions {
  templatePath: string
  name?: string
  description?: string
  category?: string
  keywords?: string[]
  aliases?: string[]
  copy?: boolean
}

const VALID_CATEGORIES = ['planning', 'implementation', 'investigation', 'management', 'special']

/**
 * Parse YAML frontmatter from template file
 */
function parseTemplateFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  try {
    return jsYaml.load(match[1], { schema: jsYaml.CORE_SCHEMA }) as Record<string, unknown> | null
  } catch {
    return null
  }
}

function parseArgs(args: string[]): RegisterModeOptions & { help?: boolean; dryRun?: boolean } {
  const result: RegisterModeOptions & { help?: boolean; dryRun?: boolean } = { templatePath: '' }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--dry-run') {
      result.dryRun = true
    } else if (arg === '--copy') {
      result.copy = true
    } else if (arg.startsWith('--name=') || arg.startsWith('--as=')) {
      result.name = arg.includes('=') ? arg.split('=')[1] : ''
    } else if (arg.startsWith('--description=')) {
      result.description = arg.slice('--description='.length)
    } else if (arg.startsWith('--category=')) {
      result.category = arg.slice('--category='.length)
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
      result.templatePath = arg
    }
  }

  return result
}

function showHelp(): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`
Usage: wm register-mode <template-path> [options]

Register an existing template as a mode in modes.yaml.

This command takes a template file and:
  1. Optionally copies it to .claude/workflows/templates/ (with --copy)
  2. Adds an entry to .claude/workflows/modes.yaml referencing the template

Arguments:
  <template-path>           Path to existing template file

Options:
  --name=NAME, --as=NAME    Mode name (default: derived from template filename)
  --description=DESC        Mode description (default: from template frontmatter)
  --category=CATEGORY       One of: ${VALID_CATEGORIES.join(', ')} (default: special)
  --keywords=K1,K2          Intent keywords (comma-separated)
  --aliases=A1,A2           Aliases for the mode (comma-separated)
  --copy                    Copy template to .claude/workflows/templates/
  --dry-run                 Preview what would be registered
  --help, -h                Show this help message

Examples:
  # Register template in-place (for templates already in .claude/workflows/templates/)
  wm register-mode .claude/workflows/templates/my-workflow.md

  # Register and copy external template
  wm register-mode /tmp/my-workflow.md --copy

  # Register with custom name
  wm register-mode /tmp/test.md --as=my-custom-mode --copy

  # Preview registration
  wm register-mode /tmp/test.md --copy --dry-run

Workflow for one-off → saved mode:
  wm init-template /tmp/my-workflow.md --phases=4   # Create template
  # ... test with --template flag ...
  wm enter --template=/tmp/my-workflow.md --dry-run
  # ... happy with it? register it ...
  wm register-mode /tmp/my-workflow.md --copy --as=my-mode
`)
}

export async function registerModeCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  if (parsed.help) {
    showHelp()
    return
  }

  if (!parsed.templatePath) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Template path is required')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Usage: wm register-mode <template-path> [options]')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Examples:')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm register-mode packages/workflow-management/templates/my-workflow.md')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('  wm register-mode /tmp/my-workflow.md --copy')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Run "wm register-mode --help" for more options.')
    process.exit(1)
  }

  const projectDir = findClaudeProjectDir()
  if (!projectDir) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Could not find .claude directory')
    process.exit(1)
  }

  // Resolve template path
  const templatePath = parsed.templatePath.startsWith('/')
    ? parsed.templatePath
    : resolve(projectDir, parsed.templatePath)

  if (!existsSync(templatePath)) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Template file not found: ${templatePath}`)
    process.exit(1)
  }

  // Read and validate template
  const content = readFileSync(templatePath, 'utf-8')
  const frontmatter = parseTemplateFrontmatter(content)

  if (!frontmatter) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Template has no YAML frontmatter')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Templates must have frontmatter with phases defined.')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Use "wm validate-template" to check the template.')
    process.exit(1)
  }

  const phases = frontmatter.phases as unknown[]
  if (!phases || !Array.isArray(phases) || phases.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Template has no phases defined')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Use "wm validate-template" to check the template.')
    process.exit(1)
  }

  // Validate phases
  const validationResult = validatePhases(phases, templatePath)
  if (!validationResult.valid) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Error: Template has invalid phases')
    for (const err of validationResult.errors) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(`  - ${err.message}`)
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Fix the template first, then try again.')
    process.exit(1)
  }

  // Determine mode name
  const templateFilename = basename(templatePath, '.md')
  const modeName = parsed.name || (frontmatter.id as string) || templateFilename

  // Validate mode name
  if (!/^[a-z][a-z0-9-]*$/.test(modeName)) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Mode name must be kebab-case: ${modeName}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Use --name= or --as= to specify a valid mode name.')
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

  // Always write to project-level paths (npm installs have read-only package paths)
  const workflowsDir = resolve(projectDir, '.claude', 'workflows')
  const modesYamlPath = resolve(workflowsDir, 'modes.yaml')
  const templatesDir = resolve(workflowsDir, 'templates')

  // Determine final template location
  let finalTemplatePath = templatePath
  let templateRef = templatePath

  if (parsed.copy) {
    finalTemplatePath = resolve(templatesDir, `${modeName}.md`)
    templateRef = `${modeName}.md`
  } else if (templatePath.startsWith(templatesDir)) {
    // Already in templates dir, use relative reference
    templateRef = basename(templatePath)
  } else {
    // External location - warn that it won't be portable
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.warn(`⚠️  Warning: Template is outside templates directory`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.warn(`   Consider using --copy to make it portable`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.warn('')
    templateRef = templatePath // Use absolute path
  }

  // Check if mode already exists
  if (existsSync(modesYamlPath)) {
    const modesContent = readFileSync(modesYamlPath, 'utf-8')
    const modesYaml = jsYaml.load(modesContent, { schema: jsYaml.CORE_SCHEMA }) as
      | Record<string, unknown>
      | undefined
    if ((modesYaml?.modes as Record<string, unknown> | undefined)?.[modeName]) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(`Error: Mode "${modeName}" already exists in modes.yaml`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error('')
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error('To update an existing mode, edit modes.yaml directly.')
      process.exit(1)
    }
  }

  // Check if copy destination exists
  if (parsed.copy && existsSync(finalTemplatePath) && finalTemplatePath !== templatePath) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Destination template already exists: ${finalTemplatePath}`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error('Delete the existing file or choose a different mode name.')
    process.exit(1)
  }

  // Build mode entry
  const displayName =
    (frontmatter.name as string) ||
    modeName.charAt(0).toUpperCase() + modeName.slice(1).replace(/-/g, ' ')
  const description =
    parsed.description || (frontmatter.description as string) || `${displayName} workflow`
  const prefix = (frontmatter.workflow_prefix as string) || modeName.substring(0, 2).toUpperCase()

  const modeEntry: Record<string, unknown> = {
    name: displayName,
    description: description,
    intent_keywords: parsed.keywords || [modeName],
    template: templateRef.startsWith('/') ? templateRef : basename(templateRef),
    workflow_prefix: prefix,
    category: parsed.category || 'special',
  }

  if (parsed.aliases && parsed.aliases.length > 0) {
    modeEntry.aliases = parsed.aliases
  }

  if (parsed.dryRun) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('=== DRY RUN ===')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('')
    if (parsed.copy) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`Would copy template:`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`  From: ${templatePath}`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`  To:   ${finalTemplatePath}`)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log('')
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`Would add to modes.yaml:`)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('---')
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  ${modeName}:`)
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

  // Copy template if requested
  if (parsed.copy && finalTemplatePath !== templatePath) {
    try {
      mkdirSync(templatesDir, { recursive: true })
      copyFileSync(templatePath, finalTemplatePath)
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`✅ Copied template to: ${finalTemplatePath}`)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(`Error: Cannot copy template: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  }

  // Update modes.yaml (ensure project workflows dir exists)
  mkdirSync(workflowsDir, { recursive: true })
  try {
    let modesYaml: Record<string, unknown> = { modes: {}, categories: {} }

    if (existsSync(modesYamlPath)) {
      const fileContent = readFileSync(modesYamlPath, 'utf-8')
      modesYaml = (jsYaml.load(fileContent, { schema: jsYaml.CORE_SCHEMA }) as
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
    ;(modesYaml.modes as Record<string, unknown>)[modeName] = modeEntry

    // Write back
    const yamlStr = jsYaml.dump(modesYaml)

    writeFileSync(modesYamlPath, yamlStr)
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`✅ Registered mode: ${modeName}`)
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(`Error: Cannot update modes.yaml: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('')
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('The mode is now available:')
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`  wm enter ${modeName}`)
}
