/**
 * kata agent-run — general-purpose agent execution via provider.
 *
 * Unified CLI for running any agent task: reviews, code generation, analysis, etc.
 * Exposes the full AgentRunOptions surface through CLI flags.
 *
 * Usage:
 *   kata agent-run --prompt=code-review                         # Text-only review
 *   kata agent-run --prompt=code-review --tools=Read,Grep       # With tools
 *   kata agent-run --prompt=refactor --tools=Read,Edit,Write    # Full agent
 *   kata agent-run --prompt=code-review --provider=gemini       # Alt provider
 *   kata agent-run --prompt=code-review --model=claude-haiku-4-5
 *   kata agent-run --prompt=code-review --max-turns=10
 *   kata agent-run --prompt=code-review --timeout=600
 *   kata agent-run --prompt=code-review --output=reviews/       # Save artifact
 *   kata agent-run --prompt=code-review --context=git_diff      # Add context
 *   kata agent-run --prompt=code-review --dry-run               # Show config
 *   kata agent-run --list                                       # List prompts
 */

import { runAgentStep } from '../providers/step-runner.js'
import { listPrompts } from '../providers/prompt.js'
import { findProjectDir } from '../session/lookup.js'

interface AgentRunArgs {
  prompt?: string
  provider: string
  model?: string
  output?: string
  context: string[]
  allowedTools?: string[]
  maxTurns?: number
  timeout?: number
  gate: boolean
  threshold?: number
  dryRun: boolean
  list: boolean
}

function parseAgentRunArgs(args: string[]): AgentRunArgs {
  const result: AgentRunArgs = {
    provider: 'claude',
    context: [],
    gate: false,
    dryRun: false,
    list: false,
  }

  for (const arg of args) {
    if (arg === '--list') {
      result.list = true
    } else if (arg === '--dry-run') {
      result.dryRun = true
    } else if (arg === '--gate') {
      result.gate = true
    } else if (arg.startsWith('--prompt=')) {
      result.prompt = arg.split('=')[1]
    } else if (arg.startsWith('--provider=')) {
      result.provider = arg.split('=')[1]
    } else if (arg.startsWith('--model=')) {
      result.model = arg.split('=')[1]
    } else if (arg.startsWith('--output=')) {
      result.output = arg.split('=')[1]
    } else if (arg.startsWith('--context=')) {
      result.context.push(arg.split('=')[1])
    } else if (arg.startsWith('--tools=')) {
      result.allowedTools = arg.split('=')[1].split(',')
    } else if (arg.startsWith('--max-turns=')) {
      result.maxTurns = Number.parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--timeout=')) {
      result.timeout = Number.parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--threshold=')) {
      result.threshold = Number.parseInt(arg.split('=')[1], 10)
    }
  }

  return result
}

export async function agentRun(args: string[]): Promise<void> {
  const parsed = parseAgentRunArgs(args)

  // --list: show available prompt templates
  if (parsed.list) {
    const prompts = listPrompts()
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log('Available prompt templates:')
    for (const name of prompts) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(`  ${name}`)
    }
    return
  }

  if (!parsed.prompt) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`Usage: kata agent-run --prompt=<name> [options]

Options:
  --prompt=<name>        Prompt template name (required)
  --provider=<name>      Provider: claude, gemini, codex (default: claude)
  --model=<model>        Override provider's default model
  --tools=<t1,t2,...>    Tools the agent can use (default: none = text-only)
  --max-turns=<n>        Max agentic turns (default: 3)
  --timeout=<seconds>    Execution timeout in seconds (default: 300)
  --context=<source>     Context source (repeatable): git_diff, spec, template, file:<path>
  --output=<path>        Save output artifact to path ({date} supported)
  --gate                 Enable score gating (blocks if score < threshold)
  --threshold=<n>        Min score to pass gate (default: 75)
  --dry-run              Show assembled config without running
  --list                 List available prompt templates`)
    process.exitCode = 1
    return
  }

  let cwd: string
  try {
    cwd = findProjectDir()
  } catch {
    cwd = process.cwd()
  }

  if (parsed.dryRun) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Provider:  ${parsed.provider}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Model:     ${parsed.model ?? '(default)'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Prompt:    ${parsed.prompt}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Context:   ${parsed.context.join(', ') || '(none)'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Tools:     ${parsed.allowedTools?.join(', ') || '(none — text-only)'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Max turns: ${parsed.maxTurns ?? 3}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Timeout:   ${parsed.timeout ?? 300}s`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Gate:      ${parsed.gate ? `yes (threshold: ${parsed.threshold ?? 75})` : 'no'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`Output:    ${parsed.output ?? '(stdout only)'}`)
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`CWD:       ${cwd}`)
    return
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.error(`Running ${parsed.prompt} via ${parsed.provider}${parsed.allowedTools ? ` (tools: ${parsed.allowedTools.join(', ')})` : ''}...`)

  const result = await runAgentStep(
    {
      provider: parsed.provider,
      model: parsed.model,
      prompt: parsed.prompt,
      context: parsed.context.length > 0 ? parsed.context : undefined,
      output: parsed.output,
      gate: parsed.gate || undefined,
      threshold: parsed.threshold,
      allowed_tools: parsed.allowedTools,
      max_turns: parsed.maxTurns,
      timeout: parsed.timeout,
    },
    { cwd },
  )

  // Output the result
  process.stdout.write(result.output + '\n')

  if (result.score !== undefined) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`Score: ${result.score}/100`)
  }
  if (result.artifactPath) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`Saved: ${result.artifactPath}`)
  }
  if (parsed.gate && !result.passed) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`Gate FAILED: score ${result.score ?? '?'} < threshold ${parsed.threshold ?? 75}`)
    process.exitCode = 1
  }
}
