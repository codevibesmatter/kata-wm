// Notes file creation for enter command
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Create a mode-specific notes file for context persistence across compaction
 * Generic implementation that works for any mode that needs interview/session notes
 */
export function createModeNotesFile(
  modeName: string,
  stateFile: string,
  sessionId: string,
  context?: Record<string, string | undefined>,
): void {
  const sessionDir = dirname(stateFile)
  const notesFile = resolve(sessionDir, `${modeName}-notes.md`)

  // Skip if already exists
  if (existsSync(notesFile)) {
    return
  }

  // Ensure directory exists
  mkdirSync(sessionDir, { recursive: true })

  const now = new Date().toISOString()

  // Build context fields from provided key-value pairs
  const contextLines = context
    ? Object.entries(context)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n')
    : ''

  const content = `# ${modeName.charAt(0).toUpperCase() + modeName.slice(1)} Interview Notes

**Session:** ${sessionId}
${contextLines}
**Started:** ${now}

---

## Interview Progress

_Notes will be appended here as interview progresses._
_This file survives context compaction._

---
`

  writeFileSync(notesFile, content, 'utf-8')
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.error(`  Created: ${modeName}-notes.md for interview context persistence`)
}

/**
 * Create fd-notes.md file for feature-documentation mode
 * This file persists interview context across compaction
 * @deprecated Use createModeNotesFile instead
 */
export function createFdNotesFile(
  stateFile: string,
  sessionId: string,
  featureDocPath?: string,
  domain?: string,
): void {
  createModeNotesFile('fd', stateFile, sessionId, {
    'Feature Doc': featureDocPath || '(new feature)',
    Domain: domain || '(to be determined)',
  })
}

/**
 * Create doctrine-notes.md file for doctrine mode
 * This file persists interview context across compaction
 * @deprecated Use createModeNotesFile instead
 */
export function createDoctrineNotesFile(
  stateFile: string,
  sessionId: string,
  targetLayer?: string,
  targetDoc?: string,
): void {
  createModeNotesFile('doctrine', stateFile, sessionId, {
    Layer: targetLayer || '(to be determined)',
    'Target Doc': targetDoc || '(to be determined)',
  })
}
