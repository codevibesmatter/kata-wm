---
initiative: GH#3-optimize-impl-loop
type: project
issue_type: feature
status: draft
priority: high
roadmap: null
owner: platform-engineering
github_issue: 3
github_milestone: null
parent_epic: null
created: 2026-02-21
updated: 2026-02-21
phases:
  - id: p1
    name: "verify-phase CLI command + wm.yaml config keys"
    deps: []
  - id: p2
    name: "Stop conditions hardening"
    deps: [p1]
  - id: p3
    name: "Per-phase loop update (implementation.md template)"
    deps: [p1, p2]
  - id: p4
    name: "Spec template update (test_cases: scaffold)"
    deps: []
---

# Optimize implementation loop: per-phase tests, sequenced review, smoke tests

> GitHub Issue: [#3](https://github.com/codevibesmatter/kata-wm/issues/3)

## Overview

The current implementation loop has three structural deficiencies proven to produce lower-quality AI code:

1. **Tests are optional** — you can exit implementation mode with zero passing tests.
2. **Reviews run on unverified code** — code review runs at end-of-feature, after all phases. Reviews on running, tested code can focus on security, performance, and scope drift — the things tests structurally cannot catch.
3. **No inner loop abstraction** — the per-phase verification sequence is assembled manually by the orchestrator from memory. There is no `kata verify-phase` command.

This feature closes all three gaps:
- New `kata verify-phase <phase-id>` CLI command — **fully config-driven**, reads all commands from `wm.yaml`
- New `wm.yaml` config keys under `project`: `build_command`, `typecheck_command`, `smoke_command`, `diff_base`, `test_file_pattern`
- `tests_pass` promoted to required; `feature_tests_added` added as new required gate in `can-exit.ts`
- Verification timestamp hardened: must be newer than latest commit
- Per-phase micro-review after tests pass (scoped to security/perf/scope)
- `test_cases:` scaffold added to spec templates

**Why config-driven matters:** kata-wm is a generic package used by any project — npm, pnpm, Go, Python, Rust, monorepo, monolith. `verify-phase` must work for all of them without modification. All project-specific commands live in `wm.yaml`, not in the package source.

**Evidence basis:** Tests as input to impl agent = +8-12pp improvement (arXiv 2402.13521). 31.7% of AI code fails at runtime despite passing typecheck (arXiv 2512.22387). Reviews on tested code have better signal-to-noise (Spotify Honk dual-loop pattern).

---

## User Story

As a **developer on any project using kata-wm**,
I want **a single `kata verify-phase` command that reads my project's build/test/smoke commands from `wm.yaml` and runs them in sequence with assertion delta and micro-review**,
so that **each implementation phase is verified on running, tested code before moving on, without me having to remember the correct sequence of commands**.

---

## Feature Behaviors

### B1: verify-phase Reads All Commands from wm.yaml

**Core:**
- **ID:** verify-phase-config-driven
- **Trigger:** Any project runs `kata verify-phase <phase-id>`
- **Expected:** Command reads `project.build_command`, `project.typecheck_command`, `project.test_command` (already exists), `project.smoke_command`, `project.diff_base`, `project.test_file_pattern` from `wm.yaml`. Uses sensible defaults if keys absent. Zero hardcoded project commands in source.
- **Verify:** Set `project.build_command: make build` in `wm.yaml`, run `kata verify-phase p1`, confirm build step runs `make build` not `npm run build`.
- **Source:** `src/commands/verify-phase.ts` (new), `src/config/wm-config.ts` (extend `WmConfig`)

#### Config Schema (new keys under `project:`)

```yaml
project:
  build_command: "npm run build"        # Step 1 — compile/build. null = skip step.
  typecheck_command: "npm run typecheck" # Step 2 — type check. null = skip step.
  test_command: "npm test"              # Step 3 — run tests (already exists in WmConfig)
  smoke_command: "node dist/index.js help"  # Step 4 — runtime smoke. null = skip step.
  diff_base: "origin/main"             # Branch for git diff baseline (default: origin/main)
  test_file_pattern: "*.test.ts"       # Glob for test files (default: *.test.ts,*.spec.ts)
```

All new keys are optional. `verify-phase` skips a step if its command is `null`. This allows projects to opt-out of steps they don't need (e.g., a Python project might set `build_command: null` and `typecheck_command: mypy src`).

#### Example configs

```yaml
# npm/TypeScript project
project:
  build_command: "npm run build"
  typecheck_command: "npm run typecheck"
  test_command: "npm test"
  smoke_command: "node dist/index.js help"
  diff_base: "origin/main"

# pnpm monorepo
project:
  build_command: "pnpm run build"
  typecheck_command: "pnpm run typecheck"
  test_command: "pnpm test"
  smoke_command: "pnpm run health"
  diff_base: "origin/staging"

# Go project
project:
  build_command: "go build ./..."
  typecheck_command: "go vet ./..."
  test_command: "go test ./..."
  smoke_command: "./bin/app --version"
  diff_base: "origin/main"
  test_file_pattern: "*_test.go"

# Python project
project:
  build_command: null                   # skip — no build step
  typecheck_command: "mypy src"
  test_command: "pytest"
  smoke_command: "python -m myapp --version"
  diff_base: "origin/main"
  test_file_pattern: "test_*.py"
```

#### UI Layer
N/A — CLI command

#### API Layer
N/A

#### Data Layer
- `WmConfig.project` extended with new optional fields
- `src/config/wm-config.ts` — add fields to `WmConfig` interface and defaults

---

### B2: verify-phase Runs Steps in Sequence (Fail-Fast)

**Core:**
- **ID:** verify-phase-full-sequence
- **Trigger:** `kata verify-phase <phase-id>` called
- **Expected:** Runs steps in order: (1) build, (2) typecheck, (3) tests, (4) smoke, (5) assertion delta, (6) micro-review. Steps configured as `null` are skipped. Fail-fast: if step N fails, steps N+1..end do not run (except `--force` overrides delta). Exits 0 if all ran pass, 1 if any fail.
- **Verify:** Confirm result JSON `steps` array contains only non-null configured steps.
- **Source:** `src/commands/verify-phase.ts`

#### Data Layer
Evidence file written after every run (pass or fail):
- Path: `.claude/verification-evidence/phase-<phase-id>-<issue>.json`
- Schema: `{ phaseId, issueNumber, timestamp: ISO8601, steps: [{name, passed, output, skipped?}], overallPassed }`
- Does NOT touch `.claude/verification-evidence/{issue}.json` — that file is owned by the configured code reviewer (`verify_command` / `reviews.code_reviewer`). These are separate gates.

---

### B3: Smoke Step Runs Configured smoke_command

**Core:**
- **ID:** verify-phase-smoke-configured
- **Trigger:** `verify-phase` reaches smoke step and `project.smoke_command` is set
- **Expected:** Runs the configured `smoke_command`. If exit non-zero: step fails with message showing the command that failed and suggesting the user check the command in `wm.yaml`. If `smoke_command` is `null` or absent: step is skipped with `{name: 'smoke', skipped: true}`.
- **Verify:** Set `smoke_command: "false"` in `wm.yaml`, run `verify-phase p1`, confirm smoke step fails.
- **Source:** `src/commands/verify-phase.ts`

---

### B4: Assertion Delta Check Detects Test Gaming

**Core:**
- **ID:** verify-phase-assertion-delta
- **Trigger:** `verify-phase` reaches delta step, after tests have run
- **Expected:** Counts assertions (`expect(`, `assert.`, `.toBe(`, `.toEqual(`, `it(`, `test(`) in changed test files (matched by `project.test_file_pattern`) before and after, using `git diff <diff_base>...HEAD`. If count decreases by 1 or more: step fails with "Assertion count decreased (before: N, after: M)." `--force` flag bypasses with warning in evidence file.
- **Verify:** Reduce assertions in a test file, run `kata verify-phase p1`, confirm delta step fails with count.
- **Source:** `src/commands/verify-phase.ts`

---

### B5: Micro-Review Runs on Phase Diff with Spec Context

**Core:**
- **ID:** verify-phase-micro-review
- **Trigger:** `verify-phase` reaches micro-review step, only if all prior steps pass
- **Expected:** Generates `git diff <diff_base>...HEAD -- <non-test-files>` (excludes test files). Attempts to extract spec section for phase from `<spec_path>/<issue>-*.md`. Uses configured `reviews.code_reviewer` from `wm.yaml`. If no reviewer configured: step is skipped with warning. Scoped prompt: security, performance, scope drift, pattern compliance. If review returns 🔴: step fails.
- **Verify:** Configure a reviewer in `wm.yaml`, run `verify-phase` on a phase with a known issue, confirm micro-review catches it.
- **Source:** `src/commands/verify-phase.ts`

---

### B6: tests_pass Gate Requires verify-phase Evidence

**Core:**
- **ID:** stop-condition-tests-pass-required
- **Trigger:** `kata can-exit` in implementation mode
- **Expected:** Requires at least one `.claude/verification-evidence/phase-*-{issue}.json` with fresh timestamp (`>` latest git commit) and `overallPassed === true`. If missing: blocked with "verify-phase has not been run." If stale or failed: blocked with "Phase <id> failed or evidence is stale."
- **Source:** `src/commands/can-exit.ts` — new `checkTestsPass()` function

---

### B7: feature_tests_added Is a New Required Gate

**Core:**
- **ID:** stop-condition-feature-tests-added
- **Trigger:** `kata can-exit` in implementation mode
- **Expected:** Counts new `test(` / `it(` / `describe(` function calls added vs `<diff_base>` in files matching `project.test_file_pattern`. If zero: blocked with "At least one new test function required."
- **Source:** `src/commands/can-exit.ts` — new `checkFeatureTestsAdded()` function; reads `diff_base` and `test_file_pattern` from `loadWmConfig()`

---

### B8: Verification Evidence Validates Timestamp

**Core:**
- **ID:** stop-condition-verification-timestamp-hardened
- **Trigger:** `kata can-exit` evaluates `checkVerificationEvidence()`
- **Expected:** After confirming `passed === true`, checks `verifiedAt` is newer than `git log -1 --format=%cI`. If stale: fails with "Verification evidence is stale (predates latest commit). Re-run your code reviewer."
- **Source:** `src/commands/can-exit.ts` — `checkVerificationEvidence()` + new `verification_stale` case in `src/messages/stop-guidance.ts`

---

### B9: Implementation Template VERIFY Sub-Phase Uses verify-phase

**Core:**
- **ID:** template-verify-phase-in-loop
- **Trigger:** Orchestrator follows `.claude/workflows/templates/implementation.md` VERIFY sub-phase
- **Expected:** VERIFY step instructions tell the agent to run `kata verify-phase <phase-id> --issue=<N>`. On non-zero exit: re-spawn impl agent with failure output. Max 3 retries. IMPL step instructions tell agent to read `test_cases:` from spec before coding.
- **Source:** `.claude/workflows/templates/implementation.md`

---

### B10: Spec Templates Include test_cases Scaffold

**Core:**
- **ID:** spec-template-test-cases
- **Trigger:** New spec created from `planning/spec-templates/feature.md` or `bug.md`
- **Expected:** Each implementation phase section includes a `test_cases:` subsection scaffold with `id`, `description`, `command`, `expected_exit` fields.
- **Source:** `planning/spec-templates/feature.md`, `planning/spec-templates/bug.md`

---

## Scope

### In Scope
- `src/config/wm-config.ts` — extend `WmConfig.project` with `build_command`, `typecheck_command`, `smoke_command`, `diff_base`, `test_file_pattern` (all optional)
- `src/commands/verify-phase.ts` — new command, reads all commands from `loadWmConfig()`
- `src/index.ts` — wire `verify-phase` into CLI router and help text
- `src/commands/can-exit.ts` — `checkVerificationEvidence()` timestamp hardening; new `checkTestsPass()`; new `checkFeatureTestsAdded()`
- `src/messages/stop-guidance.ts` — add `verification_stale` artifact type
- `.claude/workflows/templates/implementation.md` — VERIFY sub-phase step; IMPL sub-phase test_cases instruction
- `planning/spec-templates/feature.md` — add `test_cases:` scaffold
- `planning/spec-templates/bug.md` — add `test_cases:` scaffold

### Out of Scope
- Automatic retry (re-spawning impl agent) in source code — that's an orchestration doc change, not code
- Mandatory TDD enforcement
- E2E/browser tests in the inner loop
- Per-package filtering in monorepos — use `test_command` config to handle that (e.g., `turbo test --filter=...`)

---

## Design

### verify-phase Command Architecture

```
kata verify-phase <phase-id> [--issue=N] [--force] [--json]

Config read at startup (loadWmConfig()):
  build_command        → step 1 (null = skip)
  typecheck_command    → step 2 (null = skip)
  test_command         → step 3 (null = skip)
  smoke_command        → step 4 (null = skip)
  diff_base            → used by steps 5 and 6 (default: origin/main)
  test_file_pattern    → used by steps 5 and 6 (default: *.test.ts,*.spec.ts)
  reviews.code_reviewer → used by step 6 (null = skip micro-review)

Steps (in order, fail-fast):
  1. build          → project.build_command
  2. typecheck      → project.typecheck_command
  3. tests          → project.test_command
  4. smoke          → project.smoke_command
  5. delta          → git diff <diff_base>...HEAD on test files (assertion count check)
  6. micro-review   → diff on non-test files, scoped LLM prompt

Output:
  stdout: human-readable step results
  JSON:   .claude/verification-evidence/phase-<id>-<issue>.json
  exit:   0 if all (non-skipped) steps pass, 1 if any fail
```

### Defaults

| Config key | Default |
|-----------|---------|
| `project.build_command` | `null` (skipped — not all projects have a build step) |
| `project.typecheck_command` | `null` (skipped — detected by reviewer presence) |
| `project.smoke_command` | `null` (skipped — no universal default) |
| `project.diff_base` | `"origin/main"` |
| `project.test_file_pattern` | `"*.test.ts,*.spec.ts"` |

`test_command` already exists in `WmConfig` — no default change needed.

### Per-Phase Loop After This Change

```
BEFORE (manual):
  impl agent → manually runs typecheck + tests → complete tasks

AFTER (single command):
  impl agent → kata verify-phase <id> --issue=<N>
             → [pass] mark phase complete
             → [fail] re-spawn impl agent with failure output (max 3 retries)
```

### Micro-Review Prompt

```
Code passes its tests. Review this diff for:
1. Security vulnerabilities (injection, XSS, unvalidated input, secrets in code)
2. Performance regressions (blocking I/O, excessive allocation in hot paths)
3. Scope drift — does this diff match spec section [Phase X]? Flag unrequested changes.
4. Pattern compliance — follows project conventions?

Do NOT flag style, naming, or things covered by tests.
Return: PASS or FAIL with specific line references.
```

### Assertion Delta Algorithm

```
1. Get changed test files:
   git diff --name-only <diff_base>...HEAD | filter by test_file_pattern
   + git diff --name-only | filter by test_file_pattern (working tree)

2. For each changed test file, count assertions BEFORE (in diff_base):
   git show <diff_base>:<file> | grep -cE 'expect\(|assert\.|\.toBe\(|\.toEqual\('
   New files: before = 0

3. Count assertions AFTER: grep in working tree

4. If sum(after) < sum(before): FAIL with delta report
5. --force: skip with warning in evidence file
```

### feature_tests_added Algorithm

```
1. get test files changed vs diff_base:
   git diff --name-only <diff_base> | filter by test_file_pattern

2. count new test functions:
   git diff <diff_base> -- <test-files> | grep -cE '^\+(it|test|describe)\s*\('

3. if count === 0: FAIL
```

---

## Implementation

### Phase 0: Baseline Verification (BLOCKING)

| Check | Command |
|-------|---------|
| `kata can-exit` runs without errors | Run in implementation mode |
| `kata help` shows existing commands | `kata help` |
| `src/config/wm-config.ts` is readable | Read the file |
| `src/commands/can-exit.ts` is readable | Read the file |
| `planning/spec-templates/` exists | `ls planning/spec-templates/` |

---

### Phase 1: verify-phase CLI Command + Config Keys

**Files to change:**
- CHANGE: `src/config/wm-config.ts` — extend `WmConfig.project` with new optional fields
- CREATE: `src/commands/verify-phase.ts`
- CHANGE: `src/index.ts` — add `verify-phase` case + import + help text

**Implementation tasks:**

1. In `src/config/wm-config.ts`, extend `WmConfig.project`:
   ```typescript
   project?: {
     name?: string
     build_command?: string | null       // NEW: step 1
     typecheck_command?: string | null   // NEW: step 2
     test_command?: string              // already exists
     smoke_command?: string | null      // NEW: step 4
     diff_base?: string                 // NEW: git diff baseline (default: 'origin/main')
     test_file_pattern?: string         // NEW: glob pattern (default: '*.test.ts,*.spec.ts')
     ci?: string | null
   }
   ```

2. Create `src/commands/verify-phase.ts`:
   - `parseArgs(args)` — parse `<phase-id>`, `--issue=N`, `--force`, `--json`
   - `resolveIssueNumber(parsed, cfg)` — `--issue=N` → use it; else read from session state via `getCurrentSessionId()` + `readState(getStateFilePath(sid))` → `state.issueNumber`. If still undefined: throw `Error('Issue number required. Pass --issue=<N> or link session: kata link <N>')`
   - `runStep(name, command)` — `execSync(command)`, return `{name, passed, output}`. If command is `null`/`undefined`: return `{name, skipped: true, passed: true}`
   - `runAssertionDelta(cfg, force)` — implement delta algorithm using `cfg.project.diff_base` and `cfg.project.test_file_pattern`
   - `getSpecSection(issueNumber, phaseId, cfg)` — glob `<cfg.spec_path ?? 'planning/specs'>/<issueNumber>-*.md`, extract phase section. If not found: log warning, return `''`
   - `runMicroReview(phaseId, issueNumber, cfg)` — skip if no `reviews.code_reviewer`. Generate diff of non-test files. Call configured reviewer with scoped prompt. Parse for 🔴.
   - `writeEvidenceFile(phaseId, issueNumber, steps)` — write `.claude/verification-evidence/phase-<id>-<issue>.json`
   - `verifyPhase(args)` — main export, orchestrates all steps fail-fast

3. In `src/index.ts`:
   - Import `verifyPhase`
   - Add `case 'verify-phase': await verifyPhase(commandArgs); break;`
   - Add to help: `  verify-phase <phase-id> [--issue=N] [--force]   Run per-phase verification`

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "verify-phase reads build_command from wm.yaml"
    setup: "set project.build_command: 'echo BUILD_OK' in wm.yaml"
    command: "kata verify-phase p1 --issue=9999"
    expected_output_contains: ["BUILD_OK"]

  - id: tc2
    description: "verify-phase skips step when command is null"
    setup: "set project.build_command: null in wm.yaml"
    command: "kata verify-phase p1 --issue=9999"
    expected_output_contains: ["build: SKIPPED"]

  - id: tc3
    description: "verify-phase exits 1 when a step fails"
    setup: "set project.typecheck_command: 'exit 1'"
    command: "kata verify-phase p1"
    expected_exit: 1

  - id: tc4
    description: "assertion delta uses configured diff_base"
    setup: "set project.diff_base: origin/main, reduce assertions in test file"
    command: "kata verify-phase p1"
    expected_output_contains: ["delta: FAIL"]

  - id: tc5
    description: "evidence file written to correct path"
    setup: "all steps pass"
    command: "kata verify-phase p1 --issue=3"
    expected: ".claude/verification-evidence/phase-p1-3.json exists with overallPassed: true"

  - id: tc6
    description: "kata help shows verify-phase"
    command: "kata help"
    expected_output_contains: ["verify-phase"]

  - id: tc7
    description: "TypeScript compiles after all changes"
    command: "npm run typecheck"
    expected_exit: 0  # pre-existing bun:test errors excluded
```

**Acceptance criteria:**
- All commands read from `loadWmConfig()` — zero hardcoded project commands in source
- `null` config value skips step gracefully
- Evidence file written on every run
- `kata help` lists `verify-phase`
- TypeScript compiles

---

### Phase 2: Stop Conditions Hardening

**Files to change:**
- `src/commands/can-exit.ts` — timestamp hardening + two new check functions
- `src/messages/stop-guidance.ts` — add `verification_stale` artifact type

**Implementation tasks:**

1. `checkVerificationEvidence()` — after `parsed.passed === true`, additionally check `parsed.verifiedAt` > `git log -1 --format=%cI`. If stale: `{ passed: false, artifactType: 'verification_stale' }`.

2. `checkTestsPass(issueNumber)`:
   - Glob `.claude/verification-evidence/phase-*-${issueNumber}.json`
   - None found → `{ passed: false, reason: 'verify-phase has not been run. Run: kata verify-phase <phaseId> --issue=${issueNumber}' }`
   - Any stale or `overallPassed !== true` → `{ passed: false, reason: 'Phase <id> failed or evidence is stale. Re-run: kata verify-phase <phaseId>' }`
   - All fresh + passed → `{ passed: true }`

3. `checkFeatureTestsAdded()`:
   - Read `diff_base` and `test_file_pattern` from `loadWmConfig()`
   - `git diff --name-only <diff_base>` → filter to test files
   - Count new `(it|test|describe)\s*(` added
   - Zero → `{ passed: false }`

4. Wire into `validateCanExit()` for `sessionType === 'implementation'`:
   ```typescript
   const testsCheck = checkTestsPass(issueNumber)
   if (!testsCheck.passed) reasons.push(testsCheck.reason)

   const featureTestsCheck = checkFeatureTestsAdded()
   if (!featureTestsCheck.passed) reasons.push('At least one new test function required (it/test/describe)')
   ```

5. `src/messages/stop-guidance.ts` — add `'verification_stale'` case to `getArtifactMessage()`.

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "can-exit blocks when no phase evidence exists"
    setup: "implementation session, no phase evidence files"
    command: "kata can-exit"
    expected_output_contains: ["verify-phase has not been run"]

  - id: tc2
    description: "can-exit blocks when no new test functions added"
    setup: "verify-phase passed, no new test() calls vs diff_base"
    command: "kata can-exit"
    expected_output_contains: ["new test function required"]

  - id: tc3
    description: "can-exit blocks when reviewer evidence is stale"
    setup: "reviewer evidence exists with passed:true but predates latest commit"
    command: "kata can-exit"
    expected_output_contains: ["stale"]

  - id: tc4
    description: "checkFeatureTestsAdded reads diff_base from wm.yaml"
    setup: "set project.diff_base: origin/main in wm.yaml, add test function"
    command: "kata can-exit"
    expected: "feature_tests_added gate passes"
```

---

### Phase 3: Per-Phase Loop Update (implementation.md)

**Files to change:**
- `.claude/workflows/templates/implementation.md` — VERIFY sub-phase + IMPL sub-phase

**Implementation tasks:**

Replace VERIFY sub-phase step instructions with:

```markdown
Run the automated per-phase verification:

```bash
kata verify-phase <phase-id> --issue=<N>
```

Steps run automatically (build → typecheck → tests → smoke → delta → micro-review),
reading commands from the project's `wm.yaml`.

**If exits non-zero:** Re-spawn impl agent with the failure output as context.
Provide the exact failed step and output. Max 3 retry attempts, then escalate to user.

**If exits 0:** All steps passed. Mark phase complete and proceed.
```

Add to IMPL sub-phase step instructions:

```markdown
Before writing production code:
1. Read the `test_cases:` subsection of your spec phase
2. Write tests alongside (or before) production code to satisfy those test cases
```

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "implementation.md references kata verify-phase"
    command: "grep 'kata verify-phase' .claude/workflows/templates/implementation.md"
    expected_exit: 0

  - id: tc2
    description: "implementation.md references test_cases: reading"
    command: "grep 'test_cases' .claude/workflows/templates/implementation.md"
    expected_exit: 0
```

---

### Phase 4: Spec Template Update (test_cases: scaffold)

**Files to change:**
- `planning/spec-templates/feature.md`
- `planning/spec-templates/bug.md`

**Implementation tasks:**

In each template, add `test_cases:` subsection after Tasks in each implementation phase:

```markdown
test_cases:
- id: tc1
  description: "{What this test verifies}"
  command: "{Command to run}"
  expected_exit: 0
- id: tc2
  description: "{Edge case or error path}"
  command: "{Command}"
  expected_exit: 1
```

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "feature.md has test_cases: scaffold"
    command: "grep 'test_cases:' planning/spec-templates/feature.md"
    expected_exit: 0
  - id: tc2
    description: "bug.md has test_cases: scaffold"
    command: "grep 'test_cases:' planning/spec-templates/bug.md"
    expected_exit: 0
```

---

## Blast Radius

| File | Change | Notes |
|------|--------|-------|
| `src/config/wm-config.ts` | CHANGE | New optional fields on `project` |
| `src/commands/verify-phase.ts` | NEW | Core implementation |
| `src/index.ts` | CHANGE | Import + switch case + help text |
| `src/commands/can-exit.ts` | CHANGE | Timestamp hardening + 2 new check functions |
| `src/messages/stop-guidance.ts` | CHANGE | `verification_stale` case |
| `.claude/workflows/templates/implementation.md` | CHANGE | VERIFY + IMPL sub-phase steps |
| `planning/spec-templates/feature.md` | CHANGE | `test_cases:` scaffold |
| `planning/spec-templates/bug.md` | CHANGE | `test_cases:` scaffold |

No breaking changes. All new `wm.yaml` keys are optional — existing projects work unchanged until they opt in by adding keys.

---

## Decision Log

### Decision 1: All Commands from Config (No Hardcoding)

**Date:** 2026-02-21
**Chose:** All project commands read from `loadWmConfig()` at runtime
**Over:** Hardcode common defaults (`npm run build`, etc.) in source
**Reason:** kata-wm is a generic package. A Go project, Python project, or pnpm monorepo must all work without source changes. Config is the only correct boundary.

### Decision 2: null Config = Skip Step (Not Error)

**Date:** 2026-02-21
**Chose:** `null` command → step skipped gracefully with `{skipped: true, passed: true}`
**Over:** Error if command missing
**Reason:** Not every project has a build step (Python, Ruby). Skipping is the right default behavior. Users opt-in to steps by configuring commands.

### Decision 3: Smoke Test = Configured smoke_command

**Date:** 2026-02-21
**Chose:** `project.smoke_command` — project defines what "smoke" means
**Over:** Fixed URL health check or fixed CLI invocation
**Reason:** Smoke means something different for every project. A CLI tool checks `--version`. A server checks `/health`. A library checks `import`. Generic config is the only correct answer.

### Decision 4: diff_base Configurable (default: origin/main)

**Date:** 2026-02-21
**Chose:** `project.diff_base` in `wm.yaml`, default `origin/main`
**Over:** Hardcode `origin/main`
**Reason:** Projects using `origin/staging`, `origin/develop`, or trunk-based `HEAD~1` need this to be configurable.

### Decision 5: Assertion Delta Decrease-Only

**Date:** 2026-02-21
**Chose:** Fail only if assertion count decreases
**Over:** Fail if no new assertions added
**Reason:** Pure refactor phases legitimately add no tests. Decrease is the specific gaming signal.

---

## Related Work

- [baseplane#1554](https://github.com/baseplane-ai/baseplane/issues/1554) — original spec this generalizes
- [arXiv 2402.13521](https://arxiv.org/html/2402.13521v1) — tests as input +8-12pp
- [arXiv 2512.22387](https://arxiv.org/html/2512.22387) — 31.7% runtime failure
- [Spotify Honk](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) — dual-loop pattern
- `src/config/wm-config.ts` — config schema
- `src/commands/can-exit.ts` — exit gate logic
- `.claude/workflows/templates/implementation.md` — impl template
