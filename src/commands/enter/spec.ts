// Spec file parsing utilities for enter command
import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { findClaudeProjectDir } from '../../session/lookup.js'
import { parseYamlFrontmatter, type SpecYaml } from '../../yaml/index.js'
import { loadWmConfig } from '../../config/wm-config.js'

/**
 * Issue types that require spec files for implementation mode
 * - epic, feature, enhancement: Complex work that needs planning/spec
 * - bug, task, research, objective, intake: Simple work that can proceed without spec
 */
export const SPEC_REQUIRED_TYPES = ['epic', 'feature', 'enhancement']

/**
 * Get issue type from GitHub
 * First tries native GitHub issue type (.type.name), then falls back to type:* labels
 */
export function getIssueTypeFromGitHub(issueNum: number): string | null {
  try {
    // First try native GitHub issue type
    const result = execSync(`gh issue view ${issueNum} --json type,labels`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const data = JSON.parse(result.trim())

    // Check native issue type first (GitHub's built-in issue types)
    if (data.type?.name && data.type.name !== 'Unknown') {
      return data.type.name.toLowerCase()
    }

    // Fall back to type:* labels
    const labels = data.labels || []
    for (const label of labels) {
      const labelName = typeof label === 'string' ? label : label.name
      if (labelName?.startsWith('type:')) {
        return labelName.slice(5).toLowerCase() // Extract type value after 'type:'
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Check if issue type requires a spec file for implementation
 * Unknown types default to NOT requiring a spec (avoids breaking bug/task workflows)
 */
export function isSpecRequiredForType(issueType: string | null): boolean {
  if (!issueType) return false // Unknown types don't require spec (safer default)
  return SPEC_REQUIRED_TYPES.includes(issueType.toLowerCase())
}

/**
 * Get spec file size in bytes
 * Used to detect stub files that haven't been filled
 */
export function getSpecFileSize(specPath: string): number {
  try {
    const stats = statSync(specPath)
    return stats.size
  } catch {
    return 0
  }
}

/**
 * Find spec file by issue number
 * Looks for planning/specs/{issue}-*.md
 */
export function findSpecFile(issueNum: number): string | null {
  const projectRoot = findClaudeProjectDir()
  const specsDir = resolve(projectRoot, loadWmConfig().spec_path ?? 'planning/specs')

  try {
    const files = readdirSync(specsDir)
    // Find file matching pattern: {issueNum}-*.md
    const pattern = new RegExp(`^${issueNum}-.*\\.md$`)
    const match = files.find((f) => pattern.test(f))
    return match ? resolve(specsDir, match) : null
  } catch {
    return null
  }
}

/**
 * Parse YAML frontmatter from spec file
 * Uses js-yaml via yaml module
 */
export function parseSpecYaml(specPath: string): SpecYaml | null {
  return parseYamlFrontmatter<SpecYaml>(specPath)
}
