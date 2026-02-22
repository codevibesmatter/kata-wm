---
initiative: pluggable-llm-providers
type: project
issue_type: feature
status: approved
priority: medium
github_issue: 10
created: 2026-02-22
updated: 2026-02-22
phases:
  - id: p1
    name: "Provider interface and Claude adapter"
    tasks:
      - "Define AgentProvider interface in src/providers/"
      - "Extract Claude adapter from existing eval/judge.ts"
      - "Add provider registry and factory"
      - "Export providers from main package entry point"
  - id: p2
    name: "Gemini and Codex adapters"
    tasks:
      - "Implement Gemini provider (CLI wrapper)"
      - "Implement Codex provider (CLI wrapper with JSONL parsing)"
      - "Add model selection per provider"
  - id: p3
    name: "Provider setup command and onboard integration"
    tasks:
      - "Implement kata providers setup/list commands"
      - "Add providers: section to WmConfig schema"
      - "Update onboard template with provider detection step"
  - id: p4
    name: "Eval + workflow integration"
    tasks:
      - "Refactor eval judge to consume AgentProvider"
      - "Wire --judge=<provider> and --judge-model flags"
      - "Add unit tests for provider dispatch"
---

# Pluggable LLM Agent Providers

> GitHub Issue: [#10](https://github.com/codevibesmatter/kata-wm/issues/10)

## Overview

The eval harness judge is hardcoded to Claude SDK's `query()`, and there's no way for workflows to invoke external LLM agents for review gates or quality checks. This feature creates an `AgentProvider` interface in the main package (`src/providers/`) so any agent CLI (Claude, Gemini, Codex) can be used for judging, code review, spec review, or any prompt-in/text-out agent task — with full agent capabilities (tool use, file access, reasoning). The eval judge becomes a consumer of this interface, not the owner. The baseplane `agent-tools` package has working Gemini and Codex CLI wrappers that we'll adapt.

## Feature Behaviors

### B1: AgentProvider interface

**Core:**
- **ID:** agent-provider-interface
- **Trigger:** Developer imports provider types from `kata-wm` or `src/providers/`
- **Expected:** An `AgentProvider` interface exists with `run(prompt, options) → string` that all providers implement. Each provider runs the prompt through its respective agent CLI with full capabilities. The interface is generic — not eval-specific — so it can be used for judging, code review, spec review, or any agent task.
- **Verify:** TypeScript compiles, all three providers satisfy the interface
- **Source:** new src/providers/types.ts, src/providers/*.ts

#### UI Layer
N/A — CLI only.

#### API Layer
```typescript
// src/providers/types.ts
interface AgentProvider {
  name: string                        // 'claude' | 'gemini' | 'codex'
  defaultModel?: string               // provider-specific default (undefined = SDK default)
  run(prompt: string, options: AgentRunOptions): Promise<string>
}

interface AgentRunOptions {
  cwd: string                         // working directory for agent
  model?: string                      // override default model
  env?: Record<string, string>        // clean environment (caller filters CLAUDECODE*/CLAUDE_* vars)
  timeoutMs?: number                  // max execution time (default: 300_000 = 5 min)
}
```

Exported from main entry point (`src/index.ts`) so both eval and workflow code can import:
```typescript
import { getProvider, type AgentProvider } from 'kata-wm'
```

**Error handling contract:** Providers throw on failure (CLI not found, non-zero exit, timeout). Callers wrap in try/catch. Provider errors should include the provider name in the message for diagnostics. If a provider's CLI is not installed, it should fail fast with an install hint (e.g., "gemini CLI not found. Install: npm i -g @google/gemini-cli").

**Environment cleaning:** The caller builds the filtered env (stripping CLAUDECODE*, CLAUDE_CODE_ENTRYPOINT, CLAUDE_PROJECT_DIR) and passes it via `options.env`. Providers use it as-is.

#### Data Layer
N/A.

---

### B2: Claude provider (extract from existing)

**Core:**
- **ID:** claude-provider
- **Trigger:** `--judge` or `--judge=claude`
- **Expected:** Existing Claude SDK `query()` logic extracted into a provider that implements `AgentProvider`. Uses `@anthropic-ai/claude-agent-sdk` `query()` with `allowedTools: []`, `maxTurns: 3`.
- **Verify:** Running `npm run eval -- --judge` produces a valid JudgeResult with scores and verdict (structurally equivalent to pre-refactor)

#### UI Layer
N/A.

#### API Layer
```typescript
// src/providers/claude.ts
export const claudeProvider: AgentProvider = {
  name: 'claude',
  defaultModel: undefined,  // SDK picks its own default model
  async run(prompt, options) {
    // Existing query() logic from eval/judge.ts
    // Returns concatenated text chunks
  }
}
```

#### Data Layer
N/A.

---

### B3: Gemini provider

**Core:**
- **ID:** gemini-provider
- **Trigger:** `--judge=gemini`
- **Expected:** Writes the judge prompt to a temp file, then spawns `gemini` CLI with the prompt file as context. Captures stdout as the review text. Uses `--yolo` for autonomous execution, `-m` for model selection. Temp file approach avoids OS argument length limits for large prompts. Based on pattern from `baseplane/packages/agent-tools/src/gemini/index.ts`.
- **Verify:** `npm run eval -- --judge=gemini --scenario=task-mode` produces a scored review

#### UI Layer
N/A.

#### API Layer
```typescript
// src/providers/gemini.ts
export const geminiProvider: AgentProvider = {
  name: 'gemini',
  defaultModel: 'gemini-2.5-pro',
  async run(prompt, options) {
    // Write prompt to temp file, pass as file context
    // spawnSync('gemini', ['-m', model, '-p', 'Review this transcript', tempFile, '--yolo'])
    // Capture stdout via stdio: ['pipe', 'pipe', 'pipe']
    // Return stdout text, clean up temp file
  }
}
```

#### Data Layer
N/A.

---

### B4: Codex provider

**Core:**
- **ID:** codex-provider
- **Trigger:** `--judge=codex`
- **Expected:** Spawns `codex exec` with the judge prompt via stdin, parses JSONL output for agent messages. Uses `--sandbox read-only` since judge only reads transcripts. Based on pattern from `baseplane/packages/agent-tools/src/codex/runner.ts`.
- **Verify:** `npm run eval -- --judge=codex --scenario=task-mode` produces a scored review

#### UI Layer
N/A.

#### API Layer
```typescript
// src/providers/codex.ts
export const codexProvider: AgentProvider = {
  name: 'codex',
  defaultModel: 'gpt-5.2-codex',
  async run(prompt, options) {
    // spawn('codex', ['exec', '--sandbox', 'read-only', '--json', '-'])
    // Parse JSONL stdout, extract agent_message content
    // Return concatenated agent messages
  }
}
```

#### Data Layer
N/A.

---

### B5: CLI flag and provider dispatch

**Core:**
- **ID:** cli-judge-flag
- **Trigger:** User passes `--judge`, `--judge=claude`, `--judge=gemini`, or `--judge=codex`
- **Expected:** `--judge` alone defaults to `claude` (backward compatible). `--judge=<name>` selects the provider. Unknown provider name exits with error listing available providers. Optional `--judge-model=<model>` overrides the provider's default model.
- **Verify:** `npm run eval -- --judge=gemini` uses Gemini; `--judge` uses Claude; `--judge=unknown` errors with list

#### UI Layer
Console output unchanged — still prints `Agent X/100 | System Y/100 | VERDICT`.

#### API Layer
```typescript
// eval/run.ts flag parsing — match exactly '--judge' or '--judge=<provider>'
const judgeArg = args.find(a => a === '--judge' || a.startsWith('--judge='))
// --judge → { enabled: true, provider: 'claude' }
// --judge=gemini → { enabled: true, provider: 'gemini' }
const judgeProvider = judgeArg?.includes('=') ? judgeArg.split('=')[1] : 'claude'
const judgeModelArg = args.find(a => a.startsWith('--judge-model='))?.split('=')[1]
```

#### Data Layer
N/A.

---

### B6: Provider registry

**Core:**
- **ID:** provider-registry
- **Trigger:** Judge initialization
- **Expected:** A simple registry maps provider names to implementations. New providers can be added by registering in a single place. No plugin system or dynamic loading — just a `Record<string, JudgeProvider>`.
- **Verify:** Adding a mock provider to the registry makes it selectable via `--judge=mock`

#### UI Layer
N/A.

#### API Layer
```typescript
// src/providers/index.ts
import { claudeProvider } from './claude.js'
import { geminiProvider } from './gemini.js'
import { codexProvider } from './codex.js'

export const providers: Record<string, AgentProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  codex: codexProvider,
}

export function getProvider(name: string): AgentProvider {
  const p = providers[name]
  if (!p) throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`)
  return p
}
```

#### Data Layer
N/A.

---

### B7: Saved prompts and file-based prompt delivery

**Core:**
- **ID:** prompt-system
- **Trigger:** Any provider `run()` call with a prompt over a char threshold, or a caller using a saved prompt by name
- **Expected:** Two capabilities: (1) A prompt file helper that writes prompts over a configurable char threshold (default: 4000) to a temp file and returns the path — all providers use this uniformly for large prompts instead of each solving it differently. (2) A saved prompts directory (`src/providers/prompts/`) with reusable prompt templates for common tasks: transcript review (moved from `eval/prompts/`), code review, spec review. Prompts are plain markdown files loaded by name.
- **Verify:** Large prompt is written to temp file; saved prompt loads by name; temp files are cleaned up after provider returns

#### UI Layer
N/A.

#### API Layer
```typescript
// src/providers/prompt.ts

/** Write prompt to temp file if over threshold, return { text, filePath } */
export function preparePrompt(prompt: string, opts?: { thresholdChars?: number }): {
  text: string
  filePath?: string       // set if prompt was written to temp file
  cleanup: () => void     // removes temp file if created
}

/** Load a saved prompt template by name */
export function loadPrompt(name: string): string
// Looks in src/providers/prompts/{name}.md

/** List available saved prompts */
export function listPrompts(): string[]
```

Saved prompt templates:
- `transcript-review.md` — moved from `eval/prompts/transcript-review.md`
- `code-review.md` — review a diff for correctness, security, style
- `spec-review.md` — review a spec for completeness and feasibility

#### Data Layer
N/A.

---

### B8: Provider setup command and onboard integration

**Core:**
- **ID:** provider-setup
- **Trigger:** `kata providers setup` command, or onboard template p3 (custom path) asking about external reviewers
- **Expected:** A `kata providers setup` command that: (1) checks which agent CLIs are installed (`claude`, `gemini`, `codex`) and reports status, (2) for missing CLIs, prints install commands, (3) checks for required API key env vars (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` / `GEMINI_API_KEY`, `OPENAI_API_KEY`), (4) writes provider config to `wm.yaml` under a `providers:` key with the default provider and any available providers. The onboard template's p3 external review question integrates with this — when user picks a reviewer, run `kata providers setup` to verify the CLI is available.
- **Verify:** `kata providers setup` reports status for all three CLIs; onboard custom path runs setup when reviewer selected

#### UI Layer
```
$ kata providers setup

Agent Providers
───────────────────────────────────────
  claude   ✅ installed    API key: ✅ set
  gemini   ✅ installed    API key: ✅ set
  codex    ❌ not found    Install: npm i -g @openai/codex

Default provider: claude

To install missing providers:
  npm i -g @openai/codex

Wrote providers config to .claude/workflows/wm.yaml
```

Also supports `kata providers list` to show available providers without modifying config.

#### API Layer
```typescript
// src/commands/providers.ts

interface ProviderStatus {
  name: string
  installed: boolean
  apiKeySet: boolean
  apiKeyEnvVar: string
  installCommand: string
}

export async function checkProviders(): Promise<ProviderStatus[]>
export async function setupProviders(opts: { write: boolean }): Promise<void>
```

wm.yaml config addition:
```yaml
providers:
  default: claude
  available:
    - claude
    - gemini
  judge_provider: claude     # used by eval --judge when no explicit provider given
  judge_model: null           # override per-provider default model for judging
```

#### Data Layer
New `providers:` section in `WmConfig` schema (`src/config/wm-config.ts`). Optional — projects without it default to `claude` only.

---

### B9: Onboard template provider step

**Core:**
- **ID:** onboard-provider-step
- **Trigger:** Onboard template p3 (custom path), or after p1 quick path as an optional step
- **Expected:** The onboard template's external review question (currently in p3) is updated to: (1) run `kata providers setup` to detect available CLIs, (2) only offer providers whose CLI is installed, (3) write the selected reviewer to `wm.yaml` `providers.default`. For quick path, provider setup runs automatically with detected defaults (no question needed — just report what's available).
- **Verify:** Onboard custom path shows only installed providers as options; quick path auto-detects and writes config

#### UI Layer
During onboard custom path (p3):
```
AskUserQuestion: Which agent providers do you want to use?
  1. Claude only (already available)
  2. Claude + Gemini (both detected)
  3. Claude + Gemini + Codex (codex not installed — will guide setup)
  4. Skip provider setup
```

#### API Layer
Updates to `templates/onboard.md` phase p3 tasks and the External Review Setup section.

#### Data Layer
N/A — uses the same `providers:` config from B8.

---

## Non-Goals

- No web API or HTTP provider support — CLI agents only
- No concurrent multi-judge (run multiple providers and compare) — future work
- No provider-specific prompt tuning — same prompt goes to all providers
- No dynamic plugin loading or config-file-based provider registration
- No Gemini/Codex SDK library integration — CLI wrappers only (matching baseplane patterns)

## Open Questions

- [x] Should judge providers have full agent capabilities or just text gen? → Full agent (user confirmed)
- [x] Should we add a `--judge-model` flag? → Yes, include it. Simple to add and useful for comparing models within a provider.

## Implementation Phases

### Phase 1: Provider interface, prompt system, and Claude adapter

Tasks:
- Define `AgentProvider` interface and `AgentRunOptions` types in `src/providers/types.ts`
- Implement prompt file helper in `src/providers/prompt.ts` — writes prompt to temp file when over char threshold (e.g., 4000 chars), returns file path; all providers use file-based delivery for large prompts
- Add saved prompt templates directory `src/providers/prompts/` with initial templates: `transcript-review.md` (moved from `eval/prompts/`), `code-review.md`, `spec-review.md`
- Extract Claude-specific logic from `eval/judge.ts` into `src/providers/claude.ts`
- Create provider registry in `src/providers/index.ts`
- Export `AgentProvider`, `getProvider`, prompt helpers from `src/index.ts`

test_cases:
- id: tc1
  description: "TypeScript compiles cleanly"
  command: "npm run typecheck"
  expected_exit: 0
- id: tc2
  description: "Providers are importable from main package"
  command: "node -e \"import('kata-wm').then(m => console.log(Object.keys(m.providers)))\""
  expected_exit: 0

Verification:
- Types compile (`npm run typecheck`)
- `getProvider('claude')` returns a valid provider
- Prompt file helper writes to temp when prompt > threshold

### Phase 2: Gemini and Codex adapters

Tasks:
- Implement `src/providers/gemini.ts` — spawn `gemini` CLI, use prompt file for delivery
- Implement `src/providers/codex.ts` — spawn `codex exec`, use prompt file or stdin, parse JSONL
- Register both in provider registry
- Add model selection per provider

test_cases:
- id: tc1
  description: "Gemini provider returns text output"
  command: "npm run typecheck"
  expected_exit: 0
- id: tc2
  description: "Codex provider returns text output"
  command: "npm run typecheck"
  expected_exit: 0

Verification:
- Each provider satisfies the interface
- Types compile (`npm run typecheck`)

### Phase 3: Provider setup command and onboard integration

Tasks:
- Implement `kata providers setup` — check CLI availability (`which gemini`, `which codex`), check API key env vars, report status table
- Implement `kata providers list` — show available providers and their status (no writes)
- Add `providers:` section to `WmConfigSchema` in `src/config/wm-config.ts` — `default`, `available[]`, `judge_provider`, `judge_model`
- Wire `providers` subcommand in `src/index.ts` CLI dispatcher
- Update onboard template `templates/onboard.md` — p3 external review question runs `kata providers setup` to detect available CLIs, only offers installed providers as options
- Quick-path onboard (p1 → p5): auto-detect providers, write available ones to config without prompting

test_cases:
- id: tc1
  description: "kata providers list shows status"
  command: "kata providers list"
  expected_exit: 0
- id: tc2
  description: "TypeScript compiles"
  command: "npm run typecheck"
  expected_exit: 0

Verification:
- `kata providers setup` detects installed CLIs and writes config
- `kata providers list` shows status without modifying anything
- Onboard template references provider setup
- Types compile (`npm run typecheck`)

### Phase 4: Eval + workflow integration

Tasks:
- Refactor `eval/judge.ts` to consume `AgentProvider` via `getProvider()` instead of inline Claude SDK calls
- Wire `--judge=<provider>` and `--judge-model=<model>` flag parsing in `eval/run.ts`
- Update harness to pass provider name through to `judgeTranscript()`
- Update `saveJudgeArtifact` JSON to include `provider` and `model` fields (additive-only — backward compatible)
- Update console output to show which provider was used (e.g., `Judge [gemini]: Agent 85/100 ...`)
- Add unit tests for provider dispatch and score extraction

test_cases:
- id: tc1
  description: "Existing --judge flag still works (backward compat)"
  command: "npm run eval -- --judge --scenario=task-mode"
  expected_exit: 0
- id: tc2
  description: "Unknown provider errors with list"
  command: "npm run eval -- --judge=unknown --scenario=task-mode 2>&1 | grep 'Unknown provider'"
  expected_exit: 0
- id: tc3
  description: "Unit tests pass"
  command: "npm run build && npm test"
  expected_exit: 0

Verification:
- `--judge` and `--judge=claude` both work (backward compat)
- `--judge=gemini` and `--judge=codex` select correct provider
- Artifacts include provider provenance
- All tests pass
- Types compile (`npm run typecheck`)
