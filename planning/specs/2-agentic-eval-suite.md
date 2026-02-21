---
initiative: agentic-eval-suite
type: project
issue_type: feature
status: approved
priority: high
github_issue: 2
created: 2026-02-21
updated: 2026-02-21
phases:
  - id: p1
    name: Fixture web app
    description: Minimal Node.js web app for evals to operate on
    tasks:
      - "Create eval-fixtures/web-app/ with package.json, src/routes/, src/controllers/, src/models/, src/index.ts, tests/"
      - "Install kata batteries in eval-fixtures/web-app/ (.claude/ config + strict hooks)"
      - "Add .github/ISSUE_TEMPLATE/ and wm-labels.json to fixture"
  - id: p2
    name: Eval harness
    description: Runner that drives Claude through full mode flows via API
    tasks:
      - "Create eval/harness.ts: spawn Claude session, drive conversation, capture state at checkpoints"
      - "Create eval/assertions.ts: eval-specific assertions extending src/testing/assertions.ts"
      - "Create eval/run.ts: entry point, parse --scenario arg, run and report results"
      - "Add 'eval' script to package.json: tsx eval/run.ts"
  - id: p3
    name: Eval scenarios
    description: Task, planning, and implementation mode eval definitions
    tasks:
      - "Create eval/scenarios/task-mode.ts: /health route scenario with 5 assertions"
      - "Create eval/scenarios/planning-mode.ts: user auth planning scenario with 6 assertions"
      - "Run scenarios manually against fixture, iterate until passing"
  - id: p4
    name: CI integration
    description: Nightly eval runner with pass/fail reporting
    tasks:
      - "Create .github/workflows/eval.yml: nightly schedule + manual dispatch"
      - "Store results as GitHub Actions artifacts"
      - "Add eval badge to README"
---

# Agentic Eval Suite: Full Mode Flow Tests

## Overview

kata-wm shapes AI behavior through context injection, hooks, and structured templates.
The existing unit/integration tests verify the CLI mechanics but don't validate whether
Claude actually follows the mode guidance correctly in practice. This spec defines an
agentic eval suite: real Claude API sessions running against a dedicated fixture project,
asserting that full mode flows complete correctly end-to-end.

## Context: Existing Test Infrastructure

**Unit tests** (`src/commands/*.test.ts`) — CLI command behavior in isolation.
**Integration tests** (`src/testing/integration.test.ts`) — hook lifecycle without AI.
**Testing utilities** (`src/testing/`) — `createMockSession`, `runHook`, `assertThat`.

The `kata-wm/testing` package is the foundation. Agentic evals extend it with a
Claude-driven layer on top.

## Feature Behaviors

### B1: Fixture Web App

**Core:**
- **ID:** fixture-web-app
- **Trigger:** Eval suite needs a realistic target project to work on
- **Expected:** A minimal but realistic Express/Hono web app exists at `eval-fixtures/web-app/` with routes, a controller, a model layer, and a test file; kata batteries installed; GitHub repo (or local-only mode)
- **Verify:** `ls eval-fixtures/web-app/` shows expected structure; `kata doctor` passes inside it

**What it includes:**
- `package.json` with name, scripts (test, build, dev)
- `src/routes/` — 1-2 route files (users, health)
- `src/controllers/` — matching controller
- `src/models/` — simple in-memory or sqlite model
- `src/index.ts` — entry point
- `tests/` — 1-2 basic test files
- `.claude/` — kata configured with batteries + strict hooks
- `.github/ISSUE_TEMPLATE/` + `wm-labels.json`

**Non-requirement:** The web app does not need to actually run. It just needs plausible structure for kata modes to work on.

---

### B2: Eval Harness

**Core:**
- **ID:** eval-harness
- **Trigger:** `npm run eval` or `node eval/run.js <scenario>`
- **Expected:** Harness spawns a kata session against the fixture project, drives Claude through a mode flow via the Anthropic API, captures session state + artifacts at checkpoints, and reports pass/fail with evidence
- **Verify:** Running `npm run eval -- --scenario=task-mode` produces a structured result (JSON or human-readable) showing each assertion and whether it passed

**Design:**
```
eval/
  run.ts              # Entry point: parse args, run scenarios, report
  harness.ts          # Core: spawn Claude session, drive conversation, capture state
  assertions.ts       # Eval-specific assertions (extends src/testing/assertions.ts)
  scenarios/
    task-mode.ts      # Task mode eval
    planning-mode.ts  # Planning mode eval
    implementation-mode.ts  # Implementation mode eval (future)
```

**How it works:**
1. Copy fixture web app to a temp directory (clean per run)
2. Initialize a kata session (via `kata init` + set `CLAUDE_PROJECT_DIR`)
3. Send initial prompt to Claude API with kata context injected
4. Drive conversation until mode is entered, phases complete, or timeout
5. At each checkpoint, assert state.json, git log, created files
6. Report: scenario name, assertions (pass/fail), duration, token cost

**API:**
- Uses `@anthropic-ai/sdk` directly (not Claude Code CLI)
- Session state managed via `kata-wm/testing` utilities
- No real GitHub needed for local runs (can mock `gh` commands)

---

### B3: Task Mode Eval

**Core:**
- **ID:** eval-task-mode
- **Trigger:** `npm run eval -- --scenario=task-mode`
- **Expected:** Claude receives a task prompt, enters task mode, makes a focused change to the fixture project, commits, and the stop hook is satisfied
- **Verify:** `git log` shows a new commit in the fixture project; `kata can-exit` returns 0; all 3 task phases are marked completed

**Scenario prompt:** "Add a `/health` route that returns `{status: 'ok'}` to the web app"

**Assertions:**
1. Claude calls `kata enter task` (session state shows `currentMode: task`)
2. A file was changed in the fixture project (`git diff HEAD~1` is non-empty)
3. A commit was made (`git log --oneline -1` shows a new commit)
4. `kata can-exit` succeeds (all tasks complete, changes committed)
5. Completed in < 5 minutes / < 50k tokens

---

### B4: Planning Mode Eval

**Core:**
- **ID:** eval-planning-mode
- **Trigger:** `npm run eval -- --scenario=planning-mode`
- **Expected:** Claude receives a feature request, enters planning mode, completes all 4 phases (Research → Spec → Review → Finalize), and produces an approved spec file
- **Verify:** `planning/specs/*.md` exists with `status: approved`; GitHub issue linked (or skipped); spec has B1-style behaviors

**Scenario prompt:** "Plan a user authentication feature for the web app"

**Multi-turn handling:** Planning requires 4 phases. The harness drives a long conversation,
periodically checking `kata status` to detect phase transitions and waiting for
`status: approved` in the spec frontmatter (polling `planning/specs/` in the temp dir).
Timeout: 15 minutes / 200k tokens.

**Assertions:**
1. Claude enters planning mode (state: `currentMode: planning`)
2. Spec file created at `planning/specs/*.md`
3. Spec frontmatter has `status: approved`
4. Spec body includes at least one behavior section (`### B1:`)
5. All 4 phases in `completedPhases`
6. Committed (local commit if no remote)

---

## Non-Goals

- **Not a unit test runner** — the `npm test` suite stays separate; evals are expensive and slow
- **Not CI on every PR** — evals run nightly or on-demand to control cost
- **Not a real web app** — the fixture doesn't need to pass its own tests or actually serve requests
- **Not multi-model** — evals run against claude-sonnet-4-6 only for now
- **Not implementation mode** — that requires an approved spec + issue; add in a future phase
- **Not parallel** — scenarios run sequentially to avoid state conflicts

## Implementation Phases

### Phase 1: Fixture Web App
Create `eval-fixtures/web-app/` with minimal structure + kata batteries installed.
Commit to repo. No code changes to kata-wm itself.

### Phase 2: Eval Harness
Create `eval/` directory with `run.ts`, `harness.ts`, and `assertions.ts`.
Add `"eval": "tsx eval/run.ts"` to package.json scripts.
Add `ANTHROPIC_API_KEY` to required env.

### Phase 3: Task Mode Eval + Planning Mode Eval
Write `eval/scenarios/task-mode.ts` and `eval/scenarios/planning-mode.ts`.
Run manually against fixture project, iterate until passing.

### Phase 4: CI Integration
Add `.github/workflows/eval.yml` — nightly schedule, manual dispatch.
Store results as GitHub Actions artifacts. Add badge to README.
