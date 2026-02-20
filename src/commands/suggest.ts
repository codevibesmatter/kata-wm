// wm suggest - Detect mode from user message and output behavioral guidance
import { loadModesConfig } from '../config/cache.js'
import type { ModeConfig, ModesConfig, ModeBehavior } from '../state/schema.js'
import { loadWmConfig } from '../config/wm-config.js'

interface SuggestResult {
  mode: string | null
  confidence: 'high' | 'medium' | 'low'
  guidance: string
  command: string | null
  behavior: ModeBehavior | null
  searchIntent?: SearchIntent | null
}

interface SearchIntent {
  type: 'issues' | 'specs' | 'research'
  topic: string | null
  commands: string[]
}

/**
 * Detect which mode matches the user's message
 */
function detectMode(
  message: string,
  config: ModesConfig,
): { mode: string; confidence: 'high' | 'medium' | 'low' } | null {
  const lowerMessage = message.toLowerCase()

  // First pass: check strong_signals (high confidence)
  for (const [modeId, modeConfig] of Object.entries(config.modes)) {
    if (modeConfig.deprecated) continue

    const strongSignals = modeConfig.strong_signals || []
    for (const signal of strongSignals) {
      if (lowerMessage.includes(signal.toLowerCase())) {
        return { mode: modeId, confidence: 'high' }
      }
    }
  }

  // Second pass: check intent_keywords (medium confidence)
  for (const [modeId, modeConfig] of Object.entries(config.modes)) {
    if (modeConfig.deprecated) continue

    for (const keyword of modeConfig.intent_keywords ?? []) {
      // Handle prefix patterns (e.g., "task:", "bug:")
      if (keyword.endsWith(':')) {
        if (lowerMessage.startsWith(keyword.toLowerCase())) {
          return { mode: modeId, confidence: 'high' }
        }
      } else if (lowerMessage.includes(keyword.toLowerCase())) {
        return { mode: modeId, confidence: 'medium' }
      }
    }
  }

  // Third pass: check aliases (low confidence)
  for (const [modeId, modeConfig] of Object.entries(config.modes)) {
    if (modeConfig.deprecated) continue

    const aliases = modeConfig.aliases || []
    for (const alias of aliases) {
      if (lowerMessage.includes(alias.toLowerCase())) {
        return { mode: modeId, confidence: 'low' }
      }
    }
  }

  return null
}

/**
 * Extract context signals from the message
 */
function extractContext(message: string): {
  hasIssueNumber: boolean
  issueNumber: number | null
  hasResearchDoc: boolean
  researchDocPath: string | null
  hasSpecFile: boolean
  specFilePath: string | null
} {
  // Check for issue number patterns - must be explicit issue reference
  // Patterns: #123, GH#123, issue 123, issue #123
  // NOT: random numbers in paths like 2026-01-23
  const issueMatch = message.match(/(?:GH#|#|issue\s+#?)(\d{1,5})(?:\b|$)/i)
  const issueNumber = issueMatch ? Number.parseInt(issueMatch[1], 10) : null

  // Check for research doc reference (uses config-driven path)
  const wmConfig = loadWmConfig()
  const researchPathPattern = (wmConfig.research_path ?? 'planning/research').replace(/\//g, '\\/')
  const researchMatch = message.match(new RegExp(`${researchPathPattern}\\/[^\\s]+\\.md`, 'i'))
  const researchDocPath = researchMatch ? researchMatch[0] : null

  // Check for spec file reference (uses config-driven path)
  const specPathPattern = (wmConfig.spec_path ?? 'planning/specs').replace(/\//g, '\\/')
  const specMatch = message.match(new RegExp(`${specPathPattern}\\/[^\\s]+\\.md`, 'i'))
  const specFilePath = specMatch ? specMatch[0] : null

  return {
    hasIssueNumber: issueNumber !== null,
    issueNumber,
    hasResearchDoc: researchDocPath !== null,
    researchDocPath,
    hasSpecFile: specFilePath !== null,
    specFilePath,
  }
}

/**
 * Detect search intent from user message
 * Returns null if not a search query
 */
function detectSearchIntent(message: string): SearchIntent | null {
  const lowerMessage = message.toLowerCase()

  // Search patterns for issues
  const issuePatterns = [
    /(?:find|search|list|show|get|recent)\s+(?:\w+\s+)?issues?/i,
    /issues?\s+(?:for|about|related to|with)/i,
    /(?:what|which)\s+issues?\s+/i,
  ]

  // Search patterns for specs
  const specPatterns = [
    /(?:find|search|list|show|get|recent)\s+(?:\w+\s+)?specs?/i,
    /specs?\s+(?:for|about|related to|created for)/i,
    /(?:what|which)\s+specs?\s+/i,
    /spec\s+(?:created|written|exists?)/i,
  ]

  // Search patterns for research docs
  const researchPatterns = [
    /(?:find|search|list|show|get|recent)\s+(?:\w+\s+)?research/i,
    /research\s+(?:for|about|on|docs?)/i,
  ]

  // Extract topic/domain from message
  const extractTopic = (msg: string): string | null => {
    // Common domain keywords
    const domains = [
      'auth',
      'api',
      'ui',
      'frontend',
      'backend',
      'database',
      'sync',
      'notification',
      'email',
      'workflow',
      'integration',
    ]

    for (const domain of domains) {
      if (msg.includes(domain)) {
        return domain
      }
    }

    // Try to extract topic after common prepositions
    const topicMatch = msg.match(/(?:for|about|related to|with|on)\s+([a-z0-9-]+)/i)
    if (topicMatch) {
      return topicMatch[1]
    }

    return null
  }

  const topic = extractTopic(lowerMessage)

  // Check for issue search
  for (const pattern of issuePatterns) {
    if (pattern.test(lowerMessage)) {
      const commands: string[] = []
      if (topic) {
        commands.push(`gh issue list --search "${topic}" --state open --limit 20`)
        commands.push(`gh issue list --label "${topic}" --state open`)
      } else {
        commands.push('gh issue list --state open --limit 20')
      }

      return { type: 'issues', topic, commands }
    }
  }

  // Check for spec search
  const config = loadWmConfig()
  const specPath = config.spec_path ?? 'planning/specs'
  const researchPath = config.research_path ?? 'planning/research'

  for (const pattern of specPatterns) {
    if (pattern.test(lowerMessage)) {
      const commands: string[] = []
      if (topic) {
        commands.push(`ls -lt ${specPath}/*${topic}* 2>/dev/null | head -10`)
        commands.push(`grep -l "${topic}" ${specPath}/*.md 2>/dev/null | head -10`)
      } else {
        commands.push(`ls -lt ${specPath}/*.md | head -10`)
      }

      return { type: 'specs', topic, commands }
    }
  }

  // Check for research search
  for (const pattern of researchPatterns) {
    if (pattern.test(lowerMessage)) {
      const commands: string[] = []
      if (topic) {
        commands.push(`ls -lt ${researchPath}/*${topic}* 2>/dev/null | head -10`)
        commands.push(`grep -l "${topic}" ${researchPath}/*.md 2>/dev/null | head -10`)
      } else {
        commands.push(`ls -lt ${researchPath}/*.md | head -10`)
      }

      return { type: 'research', topic, commands }
    }
  }

  return null
}

/**
 * Build guidance for search intent
 */
function buildSearchGuidance(search: SearchIntent): string {
  const lines: string[] = []

  const typeNames = {
    issues: 'GitHub Issues',
    specs: 'Planning Specs',
    research: 'Research Documents',
  }

  lines.push(`# Search: ${typeNames[search.type]}`)
  if (search.topic) {
    lines.push(`**Topic:** ${search.topic}`)
  }
  lines.push('')
  lines.push('## Suggested Commands')
  lines.push('')
  for (const cmd of search.commands) {
    lines.push(`\`\`\`bash`)
    lines.push(cmd)
    lines.push(`\`\`\``)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Infer title from message for issue creation
 */
function inferTitle(message: string): string {
  // Try to extract a meaningful title from the message
  // Look for patterns like "plan X", "implement Y", "fix Z"
  const patterns = [
    /(?:plan|implement|build|fix|create|add)\s+(.+?)(?:\.|$)/i,
    /(?:planning|implementation)\s+(?:for\s+)?(.+?)(?:\.|$)/i,
    /research\s+(?:on\s+)?(.+?)(?:\.|$)/i,
  ]

  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match?.[1]) {
      // Clean up and capitalize
      const title = match[1].trim()
      return title.charAt(0).toUpperCase() + title.slice(1)
    }
  }

  // Fallback: use first 50 chars
  const cleaned = message.replace(/[^\w\s]/g, ' ').trim()
  return cleaned.slice(0, 50) || 'Untitled'
}

/**
 * Build the entry command based on context
 */
function buildCommand(
  mode: string,
  context: ReturnType<typeof extractContext>,
  message: string,
): string {
  if (context.hasIssueNumber) {
    return `wm enter ${mode} --issue=${context.issueNumber}`
  }

  // For modes that need issues, suggest creation
  const issueRequiredModes = ['planning', 'implementation', 'bugfix', 'feature-clarification']
  if (issueRequiredModes.includes(mode)) {
    const title = inferTitle(message)
    const type = mode === 'bugfix' ? 'bug' : 'feature'
    return `bgh create --type=${type} --title="${title}" && wm enter ${mode} --issue=<NEW_ISSUE>`
  }

  // Modes that don't need issues
  return `wm enter ${mode}`
}

/**
 * Build guidance markdown from mode config and context
 */
function buildGuidance(
  mode: string,
  modeConfig: ModeConfig,
  context: ReturnType<typeof extractContext>,
  globalBehavior: ModesConfig['global_behavior'],
): string {
  const lines: string[] = []

  lines.push(`# ${modeConfig.name} Mode Detected`)
  lines.push('')

  // Entry command
  const command = buildCommand(mode, context, '')
  lines.push(`**ENTER:** \`${command}\``)
  lines.push('')

  // Behavior guidance
  const behavior = modeConfig.behavior
  if (behavior) {
    // Bias
    if (behavior.bias) {
      const biasMap = {
        act: "**Bias: ACT** - Do it, don't ask for permission",
        ask: '**Bias: ASK** - Clarify before proceeding',
        cautious: '**Bias: CAUTIOUS** - Verify before destructive actions',
      }
      lines.push(biasMap[behavior.bias])
      lines.push('')
    }

    // Entry actions
    if (behavior.entry_actions?.length) {
      lines.push("## Auto-Actions (don't ask, just do)")
      for (const action of behavior.entry_actions) {
        lines.push(`- ${action.check} → ${action.then}`)
      }
      lines.push('')
    }

    // Context-specific guidance
    if (behavior.context_signals?.length) {
      lines.push('## Context Signals')
      for (const signal of behavior.context_signals) {
        // Check if this signal matches current context
        const applies =
          (signal.pattern.includes('research') && context.hasResearchDoc) ||
          (signal.pattern.includes('spec') && context.hasSpecFile) ||
          (signal.pattern.includes('issue') && context.hasIssueNumber)

        if (applies) {
          lines.push(`- **APPLIES:** ${signal.pattern}`)
          lines.push(`  → ${signal.inference}`)
          lines.push(`  → **Action:** ${signal.action}`)
        }
      }
      lines.push('')
    }

    // Never ask
    if (behavior.never_ask?.length) {
      lines.push('## Never Ask')
      for (const na of behavior.never_ask) {
        lines.push(`- ❌ "${na.question}"`)
        lines.push(`  ✅ Instead: ${na.instead}`)
      }
      lines.push('')
    }

    // OK to ask
    if (behavior.ok_to_ask?.length) {
      lines.push('## OK to Ask (only when)')
      for (const reason of behavior.ok_to_ask) {
        lines.push(`- ${reason}`)
      }
      lines.push('')
    }
  }

  // Global never ask
  if (globalBehavior?.never_ask_globally?.length) {
    lines.push('## Global Rules')
    lines.push('Never ask:')
    for (const q of globalBehavior.never_ask_globally) {
      lines.push(`- "${q}"`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * wm suggest <message>
 * Detect mode from user message and output guidance
 */
export async function suggest(args: string[]): Promise<void> {
  const message = args.join(' ')

  if (!message) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(JSON.stringify({ mode: null, confidence: null, guidance: '', command: null }))
    return
  }

  // Check for search intent FIRST (before mode detection)
  const searchIntent = detectSearchIntent(message)
  if (searchIntent) {
    const result: SuggestResult = {
      mode: null,
      confidence: 'high',
      guidance: buildSearchGuidance(searchIntent),
      command: searchIntent.commands[0] || null,
      behavior: null,
      searchIntent,
    }
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(JSON.stringify(result))
    return
  }

  // Load modes config (with project-level override if present)
  const config = await loadModesConfig()

  // Detect mode
  const detected = detectMode(message, config)

  if (!detected) {
    // No mode detected - output available modes
    const modeList = Object.entries(config.modes)
      .filter(([_, m]) => !m.deprecated)
      .map(([id, m]) => `- **${id}**: ${m.description}`)
      .join('\n')

    const result: SuggestResult = {
      mode: null,
      confidence: 'low',
      guidance: `# No Mode Detected

**⚠️ Enter a mode before proceeding:**

\`wm enter <mode>\`

## Available Modes
${modeList}

Pick the mode that matches the user's intent.`,
      command: null,
      behavior: null,
    }

    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(JSON.stringify(result))
    return
  }

  const modeConfig = config.modes[detected.mode]
  const context = extractContext(message)

  // Handle deprecated modes with redirect
  if (modeConfig.deprecated && modeConfig.redirect_to) {
    const redirectConfig = config.modes[modeConfig.redirect_to]
    if (redirectConfig) {
      const result: SuggestResult = {
        mode: modeConfig.redirect_to,
        confidence: detected.confidence,
        guidance: `# ${modeConfig.name} is Deprecated

Redirecting to **${redirectConfig.name}** mode.

\`wm enter ${modeConfig.redirect_to}\``,
        command: `wm enter ${modeConfig.redirect_to}`,
        behavior: redirectConfig.behavior || null,
      }
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(JSON.stringify(result))
      return
    }
  }

  const guidance = buildGuidance(detected.mode, modeConfig, context, config.global_behavior)
  const command = buildCommand(detected.mode, context, message)

  const result: SuggestResult = {
    mode: detected.mode,
    confidence: detected.confidence,
    guidance,
    command,
    behavior: modeConfig.behavior || null,
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(JSON.stringify(result))
}
