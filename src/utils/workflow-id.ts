/**
 * Generate a workflow ID for a linked issue
 * Issue-based workflow IDs persist across sessions (same issue = same workflow)
 *
 * @param issueNumber - GitHub issue number
 * @returns Workflow ID in format "GH#123"
 */
export function generateWorkflowIdForIssue(issueNumber: number): string {
  return `GH#${issueNumber}`
}

/**
 * Generate a workflow ID in the format: PREFIX-shortId-MMDD
 * Used for sessions not linked to an issue (ephemeral workflows)
 *
 * Examples:
 * - PL-a1b2-0112 (planning)
 * - IM-c3d4-0112 (implementation)
 * - DB-e5f6-0112 (debug)
 *
 * @param prefix - Workflow prefix (e.g., "PL", "IM", "DB")
 * @param sessionId - UUID session ID
 * @returns Workflow ID string
 */
export function generateWorkflowId(prefix: string, sessionId: string): string {
  // Extract first 4 chars of session ID (after removing hyphens)
  const shortId = sessionId.replace(/-/g, '').slice(0, 4)

  // Get MMDD from current date
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const mmdd = `${month}${day}`

  return `${prefix}-${shortId}-${mmdd}`
}

/**
 * Parse workflow ID to extract components
 *
 * @param workflowId - Workflow ID to parse
 * @returns Components { prefix, shortId, mmdd } or null if invalid format
 */
export function parseWorkflowId(workflowId: string): {
  prefix: string
  shortId: string
  mmdd: string
} | null {
  const match = workflowId.match(/^([A-Z]+)-([a-z0-9]+)-(\d{4})$/)
  if (!match) {
    return null
  }

  return {
    prefix: match[1],
    shortId: match[2],
    mmdd: match[3],
  }
}
