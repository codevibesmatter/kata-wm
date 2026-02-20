/**
 * Get current timestamp in ISO 8601 format
 * @returns ISO timestamp string
 */
export function now(): string {
  return new Date().toISOString()
}

/**
 * Parse ISO timestamp to Date
 * @param timestamp - ISO timestamp string
 * @returns Date object or null if invalid
 */
export function parseTimestamp(timestamp: string): Date | null {
  try {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) {
      return null
    }
    return date
  } catch {
    return null
  }
}

/**
 * Format timestamp for human-readable display
 * @param timestamp - ISO timestamp string
 * @returns Formatted string (e.g., "2026-01-12 10:30:45")
 */
export function formatTimestamp(timestamp: string): string {
  const date = parseTimestamp(timestamp)
  if (!date) {
    return 'Invalid timestamp'
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
