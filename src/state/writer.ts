import fs from 'node:fs/promises'
import path from 'node:path'
import { type SessionState, SessionStateSchema } from './schema.js'

/**
 * Write session state to file atomically
 *
 * Uses atomic write pattern:
 * 1. Validate with Zod
 * 2. Write to temp file (stateFile + '.tmp')
 * 3. Rename temp to final (atomic on same filesystem)
 *
 * @param stateFile - Path to state.json file
 * @param state - Session state to write
 * @throws Error if validation fails or write fails
 */
export async function writeState(stateFile: string, state: SessionState): Promise<void> {
  // 1. Validate state schema
  const validated = SessionStateSchema.parse(state)

  // 2. Ensure directory exists
  const dir = path.dirname(stateFile)
  await fs.mkdir(dir, { recursive: true })

  // 3. Write to temp file
  const tempFile = `${stateFile}.tmp`
  const content = JSON.stringify(validated, null, 2)
  await fs.writeFile(tempFile, content, 'utf-8')

  // 4. Atomic rename (same filesystem)
  await fs.rename(tempFile, stateFile)
}

/**
 * Update existing state with partial updates
 *
 * Reads current state, merges updates, writes atomically.
 * Sets updatedAt timestamp automatically.
 *
 * @param stateFile - Path to state.json file
 * @param updates - Partial state updates
 * @returns Updated state
 */
export async function updateState(
  stateFile: string,
  updates: Partial<SessionState>,
): Promise<SessionState> {
  const { readState } = await import('./reader.js')

  const current = await readState(stateFile)
  const updated: SessionState = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await writeState(stateFile, updated)
  return updated
}
