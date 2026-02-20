// YAML parsing utilities using js-yaml
import { readFileSync } from 'node:fs'
import jsYaml from 'js-yaml'

/**
 * Parse YAML frontmatter from a markdown file
 * Returns null if no frontmatter found or parse error
 */
export function parseYamlFrontmatter<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    // Extract YAML frontmatter between --- delimiters
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    return jsYaml.load(match[1], { schema: jsYaml.CORE_SCHEMA }) as T
  } catch {
    return null
  }
}

/**
 * Read full template file content (YAML frontmatter + markdown body)
 * Returns null if file not found or read error
 */
export function readFullTemplateContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Parse YAML frontmatter from string content
 */
export function parseYamlFrontmatterFromString<T>(content: string): T | null {
  try {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    return jsYaml.load(match[1], { schema: jsYaml.CORE_SCHEMA }) as T
  } catch {
    return null
  }
}
