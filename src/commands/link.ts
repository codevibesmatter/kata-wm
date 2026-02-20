// wm link - Link or manage GitHub issue linkage for current session
import { execSync } from 'node:child_process'
import { getCurrentSessionId, getStateFilePath } from '../session/lookup.js'
import { readState } from '../state/reader.js'
import { updateState } from '../state/writer.js'

/**
 * Parse command line arguments for link command
 */
function parseArgs(args: string[]): {
  show?: boolean
  clear?: boolean
  session?: string
  issueNumber?: number
} {
  const result: { show?: boolean; clear?: boolean; session?: string; issueNumber?: number } = {}

  for (const arg of args) {
    if (arg === '--show') {
      result.show = true
    } else if (arg === '--clear') {
      result.clear = true
    } else if (arg.startsWith('--session=')) {
      result.session = arg.slice('--session='.length)
    } else if (/^\d+$/.test(arg)) {
      result.issueNumber = Number.parseInt(arg, 10)
    }
  }

  return result
}

/**
 * Get GitHub repository from git remote
 */
function getGitHubRepo(): string {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
    // Parse GitHub URL (SSH or HTTPS)
    const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/)
    if (sshMatch) {
      return sshMatch[1].replace(/\.git$/, '')
    }
    const httpsMatch = remoteUrl.match(/github\.com\/(.+?)(?:\.git)?$/)
    if (httpsMatch) {
      return httpsMatch[1].replace(/\.git$/, '')
    }
    throw new Error(`Could not parse GitHub repo from: ${remoteUrl}`)
  } catch (error) {
    throw new Error(
      `Could not determine GitHub repo. Ensure you're in a git repo with a GitHub origin.\n${error instanceof Error ? error.message : error}`,
    )
  }
}

/**
 * Fetch issue details from GitHub API
 */
function fetchIssueDetails(issueNum: number): {
  title: string
  type: string
  state: string
  url: string
} {
  const repo = getGitHubRepo()
  try {
    const data = execSync(`gh api repos/${repo}/issues/${issueNum}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const issue = JSON.parse(data)

    // Try native GitHub issue type first, fall back to type:* label
    let type = issue.type?.name ?? 'Unknown'
    if (type === 'Unknown' || type === 'null') {
      // Look for type:* label
      const typeLabel = issue.labels?.find((l: { name: string }) => l.name?.startsWith('type:'))
      if (typeLabel) {
        type = typeLabel.name.replace('type:', '')
      }
    }

    return {
      title: issue.title,
      type,
      state: issue.state,
      url: issue.html_url,
    }
  } catch (error) {
    throw new Error(
      `Could not fetch issue #${issueNum}. Ensure it exists and gh CLI is authenticated.\n${error instanceof Error ? error.message : error}`,
    )
  }
}

/**
 * Show currently linked issue
 */
async function showLink(sessionId?: string): Promise<void> {
  const sid = sessionId || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sid)
  const state = await readState(stateFile)

  if (!state.issueNumber) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log('No issue linked to current session.')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log('')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log('Link an issue with: wm link <issue-number>')
    return
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`Issue: #${state.issueNumber}`)
  if (state.issueTitle || state.title) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Title: ${state.issueTitle || state.title}`)
  }
  if (state.issueType || state.githubType) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Type: ${state.issueType || state.githubType}`)
  }
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`Session: ${sid}`)
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`Mode: ${state.currentMode || 'default'}`)
}

/**
 * Clear issue linkage
 */
async function clearLink(sessionId?: string): Promise<void> {
  const sid = sessionId || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sid)
  const state = await readState(stateFile)

  if (!state.issueNumber) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log('No issue linked to current session.')
    return
  }

  const oldIssue = state.issueNumber

  await updateState(stateFile, {
    issueNumber: null,
    issueTitle: undefined,
    issueType: undefined,
    title: undefined,
    githubType: undefined,
  })

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`✓ Cleared link to issue #${oldIssue}`)
}

/**
 * Link a new issue to the session
 */
async function linkIssue(issueNum: number, sessionId?: string): Promise<void> {
  const sid = sessionId || (await getCurrentSessionId())
  const stateFile = await getStateFilePath(sid)
  const state = await readState(stateFile)

  // Check if already linked to same issue
  if (state.issueNumber === issueNum) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Already linked to issue #${issueNum}`)
    return
  }

  // Warn if switching issues
  if (state.issueNumber && state.issueNumber !== issueNum) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`⚠️  Switching from issue #${state.issueNumber} to #${issueNum}`)
  }

  // Fetch issue details from GitHub
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`Fetching issue #${issueNum}...`)
  const issue = fetchIssueDetails(issueNum)

  if (issue.state === 'closed') {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`⚠️  Warning: Issue #${issueNum} is closed.`)
  }

  // Update state with issue details
  await updateState(stateFile, {
    issueNumber: issueNum,
    issueTitle: issue.title,
    issueType: issue.type,
    title: issue.title,
    githubType: issue.type,
  })

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`✓ Linked session to issue #${issueNum}`)
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`  Title: ${issue.title}`)
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`  Type: ${issue.type}`)
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`  URL: ${issue.url}`)
}

/**
 * wm link [<issue>] [--show] [--clear] [--session=SESSION_ID]
 *
 * Link or manage GitHub issue linkage for current session
 */
export async function link(args: string[]): Promise<void> {
  const parsed = parseArgs(args)

  // Mutually exclusive: --show, --clear, or issue number
  const actions = [parsed.show, parsed.clear, parsed.issueNumber !== undefined].filter(
    Boolean,
  ).length

  if (actions === 0) {
    // Default to --show if no arguments
    await showLink(parsed.session)
    return
  }

  if (actions > 1) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('Error: Cannot combine --show, --clear, and issue number.')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('Usage:')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('  wm link <issue>     Link to issue')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('  wm link --show      Show current link')
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error('  wm link --clear     Clear current link')
    process.exitCode = 1
    return
  }

  if (parsed.show) {
    await showLink(parsed.session)
  } else if (parsed.clear) {
    await clearLink(parsed.session)
  } else if (parsed.issueNumber !== undefined) {
    await linkIssue(parsed.issueNumber, parsed.session)
  }
}
