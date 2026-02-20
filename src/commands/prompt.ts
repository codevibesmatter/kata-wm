// wm prompt - Output current mode's prompt content
import * as fs from 'node:fs/promises'
import { getCurrentSessionId, getStateFilePath, resolveTemplatePath } from '../session/lookup.js'
import { readState } from '../state/reader.js'

/**
 * Parse command line arguments for prompt command
 */
function parseArgs(args: string[]): {
  session?: string
} {
  const result: { session?: string } = {}

  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    }
  }

  return result
}

/**
 * wm prompt [--session=SESSION_ID]
 * Outputs current mode's prompt content (for hooks)
 * Returns plain text
 */
export async function prompt(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  const sessionId = parsed.session || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sessionId)
  const state = await readState(stateFile)

  if (!state.template) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error('No template set for current mode')
    process.exitCode = 1
    return
  }

  // Read template file
  try {
    const templatePath = resolveTemplatePath(state.template)
    const templateContent = await fs.readFile(templatePath, 'utf-8')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(templateContent)
  } catch {
    // biome-ignore lint/suspicious/noConsole: intentional CLI error output
    console.error(`Template not found: ${state.template}`)
    process.exitCode = 1
  }
}
