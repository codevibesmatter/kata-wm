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
 * Load and cache modes.yaml config with project-level override support
 * If yamlPath is provided, uses it as the package-level config path.
 * Otherwise, uses getModesYamlPath() to find the package-level config.
 * If a project-level modes.yaml exists, performs a shallow merge where
 * each top-level mode key from the project FULLY replaces the package entry.
 * Returns cached instance if already loaded for the same paths.
 */
export async function loadModesConfig(yamlPath?: string): Promise<ModesConfig> {
  const paths = getModesYamlPath()
  const effectivePath = yamlPath ?? paths.packagePath
  const cacheKey = `${effectivePath}:${paths.projectPath ?? ''}`

  if (!cachedInstance || cachedKey !== cacheKey) {
    // Load package-level config
    const packageConfig = await parseModesConfig(effectivePath)

    // Load and merge project-level config if it exists
    if (paths.projectPath) {
      try {
        const projectConfig = await parseModesConfig(paths.projectPath)
        // Shallow merge: project fully overrides package at each top-level key
        // modes: each mode key from project FULLY replaces the package entry (no deep merge within a mode)
        // categories, red_flags, global_behavior: project values replace package values when present
        cachedInstance = {
          ...packageConfig,
          modes: {
            ...packageConfig.modes,
            ...projectConfig.modes,
          },
          ...(projectConfig.categories !== undefined && { categories: projectConfig.categories }),
          ...(projectConfig.red_flags !== undefined && { red_flags: projectConfig.red_flags }),
          ...(projectConfig.global_behavior !== undefined && {
            global_behavior: projectConfig.global_behavior,
          }),
        }
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: surface config parse errors to user
        console.warn(
          `⚠️  Warning: Failed to parse project modes.yaml at ${paths.projectPath}: ${err instanceof Error ? err.message : err}`,
        )
        // biome-ignore lint/suspicious/noConsole: surface config parse errors to user
        console.warn('   Falling back to built-in modes.yaml')
        cachedInstance = packageConfig
      }
    } else {
      cachedInstance = packageConfig
    }
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
