# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/ (required before running tests)
npm run dev          # Watch mode build
npm run typecheck    # Type-check without emitting
npm test             # Run tests (requires a prior build)
```

To run tests after code changes: `npm run build && npm test`.

Test files live alongside source with `.test.ts` suffixes (e.g. `src/commands/can-exit.test.ts`). Node's built-in test runner (`node --test`) executes them from `dist/testing/index.js`.

The `kata` shell script at the repo root is the CLI entry point. It runs `dist/index.js` via Node when built, or falls back to Bun running `src/index.ts` directly for no-build development.

## Architecture

**kata-wm** is a TypeScript CLI published as an npm package (`kata-wm`). It wraps Claude Code projects with structured session modes, phase task enforcement, and stop hooks.

### Source layout (`src/`)

| Directory | Purpose |
|-----------|---------|
| `index.ts` | CLI dispatcher — maps `kata <command>` to handler functions; also re-exports the programmatic API |
| `commands/` | One file per CLI command (`enter.ts`, `exit.ts`, `hook.ts`, `setup.ts`, etc.) |
| `commands/enter/` | Sub-modules for the `enter` command: `task-factory.ts` (native task creation), `guidance.ts`, `template.ts`, `spec.ts` |
| `session/lookup.ts` | Project root discovery, session ID resolution, template path resolution |
| `state/` | Zod schema (`schema.ts`), reader/writer for `SessionState` JSON |
| `config/` | `wm-config.ts` loads `.claude/workflows/wm.yaml`; `cache.ts` loads and merges `modes.yaml` |
| `validation/` | Phase/template validation |
| `yaml/` | YAML frontmatter parser for template files |
| `utils/` | Workflow ID generation, session cleanup, timestamps |
| `testing/` | Test utilities exported as `kata-wm/testing` — mock sessions, hook runners, assertions, pre-built scenarios |

### Build outputs

tsup produces ESM-only output with two entry points:
- `dist/index.js` — main CLI and programmatic API
- `dist/testing/index.js` — test utilities (also used by `node --test` as the test runner)

### Runtime data layout

| Path | Contents |
|------|---------|
| `.claude/sessions/{sessionId}/state.json` | Per-session `SessionState` (mode, phase, workflow ID, history) |
| `~/.claude/tasks/{sessionId}/` | Native task files read by `can-exit` and `hook stop-conditions` |
| `.claude/workflows/wm.yaml` | Project config (`WmConfig`) |
| `.claude/workflows/modes.yaml` | Project-level mode overrides (merged over `modes.yaml` at package root) |
| `.claude/workflows/templates/` | Mode templates — `onboard.md` seeded by `kata setup`; full set seeded by `kata batteries` |
| `planning/spec-templates/` | Spec document stubs — feature, bug, epic (copied from `batteries/spec-templates/` during `kata batteries`) |

### Hook architecture

Hooks are registered in `.claude/settings.json` and call `kata hook <name>`. Each hook reads Claude Code's stdin JSON, extracts `session_id`, and outputs a JSON decision. The session ID from hook stdin **must** be forwarded as `--session=ID` to any subcommand — there is no automatic session detection at runtime.

| Hook event | Command | Role |
|------------|---------|------|
| `SessionStart` | `kata hook session-start` | Init session registry, inject mode context |
| `UserPromptSubmit` | `kata hook user-prompt` | Detect mode intent, suggest entering a mode |
| `Stop` | `kata hook stop-conditions` | Block exit while native tasks are incomplete |
| `PreToolUse` (optional) | `kata hook mode-gate` / `task-deps` / `task-evidence` | Strict-mode enforcement |

### Mode and template system

Built-in modes are defined in `modes.yaml` (package root). Each mode references a template filename with YAML frontmatter defining phases, task titles, and dependency chains.

**Template sources:**
- `templates/` — system templates only: `onboard.md` and `SESSION-TEMPLATE.template.md`
- `batteries/templates/` — canonical mode templates (implementation, planning, task, bugfix, etc.)

After setup, the project owns copies under `.claude/workflows/templates/`. The package files are seeds only, not used at runtime. To update project templates with newer versions, run `kata batteries --update`.

Project modes in `.claude/workflows/modes.yaml` are merged over the built-in set with project definitions taking precedence.

### Key dependencies

- **zod** — schema validation for `SessionState`, `ModeConfig`, and config files
- **js-yaml** — YAML parsing for `modes.yaml`, `wm.yaml`, and template frontmatter

## Data-driven design principles

**No hardcoded mode names in logic.** Mode behavior is driven by fields in `modes.yaml`:
- `issue_handling: "required" | "none"` — whether mode entry requires a GitHub issue
- `stop_conditions: string[]` — which exit checks to run (`tasks_complete`, `committed`, `pushed`, `verification`, `tests_pass`, `feature_tests_added`). Empty array = can always exit.

When adding new per-mode behavior, add a field to `modes.yaml` + `ModeConfigSchema`, never hardcode mode names in TypeScript.

## Eval harness (`eval/`)

Agentic eval suite using `@anthropic-ai/claude-agent-sdk`. The harness drives inner Claude agents through kata scenarios with real tool execution.

### Key design decisions

- **`settingSources: ['project']`** loads `.claude/settings.json` — hooks fire naturally in the SDK, no manual context injection needed. Never use `appendSystemPrompt` for hook context.
- **`permissionMode: 'bypassPermissions'`** — full agent autonomy, no tool approval prompts.
- **AskUserQuestion pause/resume** — a PreToolUse hook intercepts AskUserQuestion, stops the session (`continue: false`), outputs question + session_id. Resume with `--resume=<session_id> --answer="<choice>"`.
- **Fixture per scenario** — `EvalScenario.fixture` field selects which `eval-fixtures/` dir to copy. Fresh projects get `git init` automatically.
- **`CLAUDE_PROJECT_DIR` stripped** from inner agent env so it doesn't escape to the outer project.

### Running evals

```bash
npx tsx eval/run.ts --scenario=onboard --verbose       # Single scenario
npx tsx eval/run.ts --list                              # List scenarios
npx tsx eval/run.ts --scenario=onboard --project=<dir> --resume=<sid> --answer="Quick"  # Resume paused
```

### Eval mode

`eval` is a project-level mode override (`.claude/workflows/modes.yaml`), not in the batteries templates. Enter with `kata enter eval` — creates per-scenario tasks with dependency chains.

### Fixtures

| Fixture | Path | Description |
|---------|------|-------------|
| `tanstack-start` | `eval-fixtures/tanstack-start/` | Fresh TanStack Start app, no kata config |
| `web-app` | `eval-fixtures/web-app/` | Pre-configured with kata hooks, wm.yaml, templates |

## Project root resolution

`findClaudeProjectDir()` walks up from cwd looking for `.claude/sessions/` or `.claude/workflows/`. It **stops at `.git` boundaries** to prevent escaping into a parent project (e.g., eval projects nested under this repo). If cwd has `.git` but no `.claude/`, it's a fresh project — the walk stops there.
