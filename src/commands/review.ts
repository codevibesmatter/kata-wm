/**
 * kata review — convenience wrapper around `kata agent-run` for reviews.
 *
 * Adds smart default context per prompt name (git_diff for code-review, etc.)
 * and delegates to agent-run for execution.
 *
 * Usage:
 *   kata review --prompt=code-review                     # Review with default provider
 *   kata review --prompt=spec-review --provider=gemini   # Specific provider
 *   kata review --prompt=code-review --model=claude-haiku-4-5
 *   kata review --prompt=code-review --output=reviews/   # Save artifact
 *   kata review --list                                   # List available prompts
 *   kata review --dry-run --prompt=code-review           # Show assembled config
 */

import { agentRun } from './agent-run.js'

/** Default context sources per review prompt name. */
const REVIEW_DEFAULTS: Record<string, string[]> = {
  'code-review': ['git_diff'],
  'spec-review': ['spec'],
  'transcript-review': ['transcript', 'template'],
  'verify-fix-review': ['git_diff'],
}

export async function review(args: string[]): Promise<void> {
  // Inject default context if none provided
  const hasContext = args.some(a => a.startsWith('--context='))
  if (!hasContext) {
    const promptName = args.find(a => a.startsWith('--prompt='))?.split('=')[1]
    if (promptName && REVIEW_DEFAULTS[promptName]) {
      args = [...args, ...REVIEW_DEFAULTS[promptName].map(c => `--context=${c}`)]
    }
  }

  await agentRun(args)
}
