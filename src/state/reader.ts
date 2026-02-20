import fs from 'node:fs/promises'
import { type SessionState, SessionStateSchema } from './schema.js'

/**
 * Read and validate session state from file
 * @param stateFile - Path to state.json file
 * @returns Validated session state
 * @throws Error if file missing, parse fails, or validation fails
 */
export async function readState(stateFile: string): Promise<SessionState> {
  try {
    const content = await fs.readFile(stateFile, 'utf-8')
    const parsed = JSON.parse(content)
    const validated = SessionStateSchema.parse(parsed)
    return validated
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`State file not found: ${stateFile}\nRun: wm doctor --fix`)
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to parse state file (invalid JSON): ${stateFile}\n${error.message}\nRun: wm doctor --fix`,
      )
    }

    if (error instanceof Error && error.name === 'ZodError') {
      throw new Error(
        `Invalid state file schema: ${stateFile}\n${error.message}\nRun: wm doctor --fix`,
      )
    }

    throw error
  }
}

/**
 * Check if state file exists
 * @param stateFile - Path to state.json file
 * @returns true if file exists, false otherwise
 */
export async function stateExists(stateFile: string): Promise<boolean> {
  try {
    await fs.access(stateFile)
    return true
  } catch {
    return false
  }
}
