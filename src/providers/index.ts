/**
 * Provider registry — maps names to AgentProvider implementations.
 */

export type { AgentProvider, AgentRunOptions, ModelOption, ThinkingLevel } from './types.js'
export { preparePrompt, loadPrompt, listPrompts } from './prompt.js'
export type { PreparedPrompt } from './prompt.js'
export { claudeProvider } from './claude.js'
export { geminiProvider } from './gemini.js'
export { codexProvider } from './codex.js'

import type { AgentProvider } from './types.js'
import { claudeProvider } from './claude.js'
import { geminiProvider } from './gemini.js'
import { codexProvider } from './codex.js'

const providers: Record<string, AgentProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  codex: codexProvider,
}

/**
 * Get a provider by name. Throws if not found.
 */
export function getProvider(name: string): AgentProvider {
  const p = providers[name]
  if (!p) {
    throw new Error(
      `Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`,
    )
  }
  return p
}

/**
 * Register a provider. Used by gemini/codex adapters to self-register.
 */
export function registerProvider(provider: AgentProvider): void {
  providers[provider.name] = provider
}

/**
 * List registered provider names.
 */
export function listProviders(): string[] {
  return Object.keys(providers)
}
