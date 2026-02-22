/**
 * Prompt helpers — temp file delivery for large prompts, saved prompt loading.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getPackageRoot } from '../session/lookup.js'

const DEFAULT_THRESHOLD = 4000

export interface PreparedPrompt {
  /** The original prompt text. */
  text: string
  /** Path to temp file if prompt exceeded threshold. */
  filePath?: string
  /** Call to clean up the temp file (no-op if none was created). */
  cleanup: () => void
}

/**
 * Write prompt to a temp file if it exceeds the char threshold.
 * All providers should use this for uniform large-prompt handling.
 */
export function preparePrompt(
  prompt: string,
  opts?: { thresholdChars?: number },
): PreparedPrompt {
  const threshold = opts?.thresholdChars ?? DEFAULT_THRESHOLD

  if (prompt.length <= threshold) {
    return { text: prompt, cleanup: () => {} }
  }

  const tempDir = join(tmpdir(), 'kata-wm-prompts')
  mkdirSync(tempDir, { recursive: true })
  const filePath = join(tempDir, `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`)
  writeFileSync(filePath, prompt, 'utf-8')

  return {
    text: prompt,
    filePath,
    cleanup: () => {
      try {
        unlinkSync(filePath)
      } catch {
        // Already cleaned up
      }
    },
  }
}

/**
 * Load a saved prompt template by name.
 * Looks in src/providers/prompts/{name}.md (compiled to dist/providers/prompts/).
 */
export function loadPrompt(name: string): string {
  const promptPath = join(getPackageRoot(), 'src', 'providers', 'prompts', `${name}.md`)
  if (!existsSync(promptPath)) {
    const available = listPrompts()
    throw new Error(
      `Prompt not found: ${name}. Available: ${available.join(', ')}`,
    )
  }
  return readFileSync(promptPath, 'utf-8')
}

/**
 * List available saved prompt template names.
 */
export function listPrompts(): string[] {
  const promptDir = join(getPackageRoot(), 'src', 'providers', 'prompts')
  if (!existsSync(promptDir)) return []
  return readdirSync(promptDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
}
