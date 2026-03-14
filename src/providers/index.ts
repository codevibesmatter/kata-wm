/**
 * Provider registry — maps names to AgentProvider implementations.
 *
 * Built-in providers: claude, gemini, codex.
 * Project-level plugins: .kata/providers/*.yaml (loaded on first access).
 */

export type { AgentProvider, AgentRunOptions, ModelOption, ThinkingLevel, ProviderCapabilities } from './types.js'
export { CANONICAL_TOOLS, isAllTools } from './types.js'
export { preparePrompt, loadPrompt, listPrompts } from './prompt.js'
export type { PreparedPrompt } from './prompt.js'
export { claudeProvider } from './claude.js'
export { geminiProvider } from './gemini.js'
export { codexProvider } from './codex.js'
export { createCliProvider, loadProviderPlugins } from './cli-provider.js'
export type { CliProviderConfig } from './cli-provider.js'
export { runAgentStep, extractScore } from './step-runner.js'
export type { StepContext, StepRunResult } from './step-runner.js'

import type { AgentProvider } from './types.js'
import { claudeProvider } from './claude.js'
import { geminiProvider } from './gemini.js'
import { codexProvider } from './codex.js'
import { loadProviderPlugins } from './cli-provider.js'
import { getProjectProvidersDir } from '../session/lookup.js'

const providers: Record<string, AgentProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  codex: codexProvider,
}

let pluginsLoaded = false

/**
 * Load project-level provider plugins from .kata/providers/.
 * Called lazily on first getProvider/listProviders access.
 */
function ensurePluginsLoaded(): void {
  if (pluginsLoaded) return
  pluginsLoaded = true

  try {
    const dir = getProjectProvidersDir()
    const plugins = loadProviderPlugins(dir)
    for (const p of plugins) {
      if (providers[p.name]) {
        // Project plugin overrides built-in
        process.stderr.write(`kata: provider plugin '${p.name}' overrides built-in\n`)
      }
      providers[p.name] = p
    }
  } catch {
    // No project dir found — no plugins to load
  }
}

/**
 * Get a provider by name. Throws if not found.
 * Loads project-level plugins on first call.
 */
export function getProvider(name: string): AgentProvider {
  ensurePluginsLoaded()
  const p = providers[name]
  if (!p) {
    throw new Error(
      `Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`,
    )
  }
  return p
}

/**
 * Register a provider programmatically.
 */
export function registerProvider(provider: AgentProvider): void {
  providers[provider.name] = provider
}

/**
 * List registered provider names.
 * Loads project-level plugins on first call.
 */
export function listProviders(): string[] {
  ensurePluginsLoaded()
  return Object.keys(providers)
}

/**
 * Reset plugin loading state (for testing).
 */
export function resetProviderPlugins(): void {
  pluginsLoaded = false
  // Remove non-built-in providers
  for (const name of Object.keys(providers)) {
    if (name !== 'claude' && name !== 'gemini' && name !== 'codex') {
      delete providers[name]
    }
  }
}
