/**
 * kata providers — check, list, and setup agent provider CLIs.
 *
 * All providers use OAuth/CLI login (not API keys).
 *
 * Usage:
 *   kata providers list      Show provider status (read-only)
 *   kata providers setup     Check CLIs, write config to wm.yaml
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jsYaml from 'js-yaml'
import { findClaudeProjectDir } from '../session/lookup.js'

export interface ProviderStatus {
  name: string
  installed: boolean
  authMethod: string
  loginCommand: string
  installCommand: string
  defaultModel: string
}

const PROVIDER_DEFS: Array<{
  name: string
  command: string
  authMethod: string
  loginCmd: string
  installCmd: string
  defaultModel: string
}> = [
  {
    name: 'claude',
    command: 'claude',
    authMethod: 'OAuth (claude login)',
    loginCmd: 'claude login',
    installCmd: 'npm i -g @anthropic-ai/claude-code',
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    name: 'gemini',
    command: 'gemini',
    authMethod: 'OAuth (gemini auth login)',
    loginCmd: 'gemini auth login',
    installCmd: 'npm i -g @google/gemini-cli',
    defaultModel: 'gemini-2.5-pro',
  },
  {
    name: 'codex',
    command: 'codex',
    authMethod: 'OAuth (codex login)',
    loginCmd: 'codex login',
    installCmd: 'npm i -g @openai/codex',
    defaultModel: 'gpt-5.2-codex',
  },
]

function isCommandAvailable(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function checkProviders(): ProviderStatus[] {
  return PROVIDER_DEFS.map((def) => ({
    name: def.name,
    installed: isCommandAvailable(def.command),
    authMethod: def.authMethod,
    loginCommand: def.loginCmd,
    installCommand: def.installCmd,
    defaultModel: def.defaultModel,
  }))
}

function printProviderStatus(statuses: ProviderStatus[]): void {
  process.stdout.write('\nAgent Providers\n')
  process.stdout.write(`${'─'.repeat(50)}\n`)

  for (const s of statuses) {
    const installed = s.installed ? '✅ installed' : '❌ not found'
    process.stdout.write(
      `  ${s.name.padEnd(10)} ${installed}\n`,
    )
    if (s.installed) {
      process.stdout.write(`             Auth: ${s.authMethod}\n`)
    }
  }

  const available = statuses.filter((s) => s.installed)
  process.stdout.write(`\nDefault provider: ${available[0]?.name ?? 'none'}\n`)

  const missing = statuses.filter((s) => !s.installed)
  if (missing.length > 0) {
    process.stdout.write('\nTo install missing providers:\n')
    for (const m of missing) {
      process.stdout.write(`  ${m.installCommand}\n`)
    }
  }

  const notLoggedIn = statuses.filter((s) => s.installed)
  if (notLoggedIn.length > 0) {
    process.stdout.write('\nTo authenticate:\n')
    for (const s of notLoggedIn) {
      process.stdout.write(`  ${s.loginCommand}\n`)
    }
  }
  process.stdout.write('\n')
}

function writeProviderConfig(statuses: ProviderStatus[]): void {
  let projectRoot: string
  try {
    projectRoot = findClaudeProjectDir()
  } catch {
    process.stderr.write('No kata project found. Run: kata setup\n')
    process.exitCode = 1
    return
  }

  const configPath = join(projectRoot, '.claude', 'workflows', 'wm.yaml')
  if (!existsSync(configPath)) {
    process.stderr.write(`Config not found: ${configPath}\n`)
    process.exitCode = 1
    return
  }

  const raw = readFileSync(configPath, 'utf-8')
  const config = (jsYaml.load(raw, { schema: jsYaml.CORE_SCHEMA }) as Record<string, unknown>) ?? {}

  const available = statuses.filter((s) => s.installed).map((s) => s.name)

  config.providers = {
    default: available[0] ?? 'claude',
    available,
    judge_provider: available[0] ?? 'claude',
    judge_model: null,
  }

  writeFileSync(configPath, jsYaml.dump(config, { lineWidth: 120 }), 'utf-8')
  process.stdout.write(`Wrote providers config to ${configPath}\n`)
}

export async function providers(args: string[]): Promise<void> {
  // Filter out --session= flags injected by the kata shell wrapper
  const filteredArgs = args.filter((a) => !a.startsWith('--session='))
  const subcommand = filteredArgs[0] || 'list'
  const jsonMode = filteredArgs.includes('--json')

  const statuses = checkProviders()

  switch (subcommand) {
    case 'list': {
      if (jsonMode) {
        process.stdout.write(JSON.stringify(statuses, null, 2) + '\n')
      } else {
        printProviderStatus(statuses)
      }
      break
    }

    case 'setup': {
      if (jsonMode) {
        process.stdout.write(JSON.stringify(statuses, null, 2) + '\n')
      } else {
        printProviderStatus(statuses)
      }
      writeProviderConfig(statuses)
      break
    }

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`)
      process.stderr.write('Usage: kata providers [list|setup] [--json]\n')
      process.exitCode = 1
  }
}
