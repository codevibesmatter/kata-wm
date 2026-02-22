// Config cache for modes.yaml
import { parseModesConfig } from './parser.js'
import type { ModesConfig } from '../state/schema.js'
import { getModesYamlPath } from '../session/lookup.js'

/**
 * Singleton cache for modes.yaml configuration
 * Ensures config is parsed only once per process
 */
let cachedInstance: ModesConfig | null = null
let cachedKey: string | null = null

/**
 * Shallow-merge an overlay config onto a base config.
 * Each mode key from overlay FULLY replaces the base entry (no deep merge within a mode).
 * Top-level arrays (categories, red_flags, global_behavior) are replaced when present.
 */
function mergeModesConfig(base: ModesConfig, overlay: ModesConfig): ModesConfig {
  return {
    ...base,
    modes: {
      ...base.modes,
      ...overlay.modes,
    },
    ...(overlay.categories !== undefined && { categories: overlay.categories }),
    ...(overlay.red_flags !== undefined && { red_flags: overlay.red_flags }),
    ...(overlay.global_behavior !== undefined && {
      global_behavior: overlay.global_behavior,
    }),
  }
}

/**
 * Load and cache modes.yaml config with 3-tier merge support.
 * Merge order (lowest to highest priority): package → user → project.
 * Each layer's mode keys fully replace matching keys from lower layers.
 *
 * If yamlPath is provided, uses it as the package-level config path.
 * Otherwise, uses getModesYamlPath() to find paths at all tiers.
 * Returns cached instance if already loaded for the same paths.
 */
export async function loadModesConfig(yamlPath?: string): Promise<ModesConfig> {
  const paths = getModesYamlPath()
  const effectivePath = yamlPath ?? paths.packagePath
  const cacheKey = `${effectivePath}:${paths.userPath ?? ''}:${paths.projectPath ?? ''}`

  if (!cachedInstance || cachedKey !== cacheKey) {
    // Load package-level config (always present)
    let merged = await parseModesConfig(effectivePath)

    // Merge user-level config if it exists
    if (paths.userPath) {
      try {
        const userConfig = await parseModesConfig(paths.userPath)
        merged = mergeModesConfig(merged, userConfig)
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: surface config parse errors to user
        console.warn(
          `⚠️  Warning: Failed to parse user modes.yaml at ${paths.userPath}: ${err instanceof Error ? err.message : err}`,
        )
      }
    }

    // Merge project-level config if it exists (highest priority)
    if (paths.projectPath) {
      try {
        const projectConfig = await parseModesConfig(paths.projectPath)
        merged = mergeModesConfig(merged, projectConfig)
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: surface config parse errors to user
        console.warn(
          `⚠️  Warning: Failed to parse project modes.yaml at ${paths.projectPath}: ${err instanceof Error ? err.message : err}`,
        )
      }
    }

    cachedInstance = merged
    cachedKey = cacheKey
  }

  return cachedInstance
}

/**
 * Resolve mode aliases to canonical mode name
 * @param config - Modes configuration
 * @param mode - Mode name or alias
 * @returns Canonical mode name
 */
export function resolveModeAlias(config: ModesConfig, mode: string): string {
  // Check if already canonical
  if (config.modes[mode]) {
    return mode
  }

  // Check aliases
  for (const [canonical, modeConfig] of Object.entries(config.modes)) {
    if (modeConfig.aliases?.includes(mode)) {
      return canonical
    }
  }

  // Not found - return as-is (caller should validate)
  return mode
}

/**
 * Clear cached config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedInstance = null
  cachedKey = null
}

/**
 * Get cached config without loading
 */
export function getCachedConfig(): ModesConfig | null {
  return cachedInstance
}
