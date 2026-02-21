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
    name: "verify-phase CLI command"
    deps: []
  - id: p2
    name: "Stop conditions hardening"
    deps: [p1]
  - id: p3
    name: "Per-phase loop update (implementation.md template)"
    deps: [p1, p2]
  - id: p4
    name: "Spec template update"
    deps: []
---

# Optimize implementation loop: per-phase tests, sequenced review, smoke tests

> GitHub Issue: [#3](https://github.com/codevibesmatter/kata-wm/issues/3)

## Overview

The current implementation loop has three structural deficiencies proven to produce lower-quality AI code:

1. **Tests are optional** — `tests_pass` is `required: false` (or absent). You can exit implementation mode with zero passing tests.
2. **Reviews run on unverified code** — code review runs at end-of-feature, after all phases, meaning it catches behavioral bugs alongside quality issues. Reviews on running, tested code can focus on security, performance, and scope drift — the things tests structurally cannot catch.
3. **No inner loop abstraction** — the per-phase verification sequence (build + typecheck + test + smoke + review) is assembled manually by the orchestrator from memory. There is no `kata verify-phase` command.

This feature closes all three gaps:
- New `kata verify-phase <phase-id>` CLI command wrapping all verification steps into one auditable call
- `tests_pass` promoted to required; `feature_tests_added` added as new required gate
- Verification timestamp check hardened to validate `passed == true` AND timestamp newer than latest commit
- Per-phase micro-review after tests pass (scoped to security/perf/scope, not "find all issues")
- `test_cases:` section added to spec templates, passed as input to impl agent before coding

**Evidence basis:** Tests as input to impl agent = +8-12pp improvement (arXiv 2402.13521). 31.7% of AI code fails at runtime despite passing typecheck (arXiv 2512.22387). Reviews on tested code have better signal-to-noise than reviews on unverified code (Spotify Honk dual-loop pattern).

---

## User Story

As a **developer running implementation mode with kata-wm**,
I want **a single `kata verify-phase` command that runs build, typecheck, tests, smoke, assertion delta check, and micro-review in sequence**,
so that **each phase is verified on running code before review, preventing bugs from accumulating across phases and ensuring test coverage is present before review adds signal**.

---

## Feature Behaviors

### B1: verify-phase Command Executes Full Verification Sequence

**Core:**
- **ID:** verify-phase-full-sequence
- **Trigger:** Impl agent (or human) runs `kata verify-phase <phase-id>` after implementing a spec phase
- **Expected:** Command runs 5 steps in order (fail-fast): (1) build, (2) typecheck, (3) tests, (4) smoke, (5) delta, (6) micro-review. Returns structured JSON result with pass/fail per step and exits non-zero if any step fails.
- **Verify:** Run `kata verify-phase p1` after a phase implementation, confirm each of the steps runs and result JSON `steps` array contains entries with names: `build`, `typecheck`, `tests`, `smoke`, `delta`, `micro-review`.
- **Source:** `src/commands/verify-phase.ts` (new file)

#### UI Layer
N/A — CLI command

#### API Layer
N/A — CLI command, no HTTP API

#### Data Layer
- **Per-phase result only**: written to `.claude/verification-evidence/phase-<phase-id>-<issue>.json`
- Format: `{ phaseId, issueNumber, timestamp, steps: [{name, passed, output}], overallPassed }`
- **Does NOT touch `.claude/verification-evidence/{issue}.json`** — that file is owned by the configured code reviewer (Gemini/Codex). These are separate gates: `verify-phase` checks code correctness; the reviewer checks behavior alignment. They coexist.
- `can-exit.ts` adds a new `checkTestsPass()` function that reads `phase-*-{issue}.json` files, separate from the existing `checkVerificationEvidence()` that reads `{issue}.json`. Both must pass.

---

### B2: Smoke Test Step Fails If CLI Not Buildable

**Core:**
- **ID:** verify-phase-smoke-test-required
- **Trigger:** `verify-phase` command reaches smoke test step
- **Expected:** Runs `node dist/index.js help` — if the built CLI fails to start or exits non-zero, step fails with clear message "CLI smoke test failed. Check build output: npm run build". Smoke test is NOT skipped.
- **Verify:** Run `kata verify-phase p1` with a broken build, confirm `smoke` step fails with message referencing `dist/index.js`.
- **Source:** `src/commands/verify-phase.ts`

#### UI Layer
N/A

#### API Layer
N/A — uses built `dist/index.js` as smoke target

#### Data Layer
N/A

---

### B3: Assertion Delta Check Detects Test Gaming

**Core:**
- **ID:** verify-phase-assertion-delta
- **Trigger:** `verify-phase` command reaches assertion delta step, after tests have run
- **Expected:** Counts test assertions (`expect(`, `assert.`, `t.is(`, `it(`, `test(`) in changed test files before and after implementation using `git diff`. If count decreases by 1 or more: step fails with message "Assertion count decreased (before: N, after: M). Tests may have been removed to pass. Confirm before proceeding." Requires `--force` flag to override.
- **Verify:** Create a test file with 5 assertions, reduce to 3, run `kata verify-phase p1`, confirm step fails with count delta message.
- **Source:** `src/commands/verify-phase.ts`

#### UI Layer
N/A

#### API Layer
N/A — uses `git diff` to detect changed test files

#### Data Layer
N/A

---

### B4: Micro-Review Runs on Phase Diff with Spec Context

**Core:**
- **ID:** verify-phase-micro-review
- **Trigger:** `verify-phase` command reaches micro-review step, only if all prior steps pass
- **Expected:** Generates `git diff origin/main...HEAD -- <changed-files>` and extracts spec section for context. Spec section is located by: reading `planning/specs/<issue>-*.md` (glob match on issue number), then extracting markdown between `### Phase <phase-id>` heading and the next `### Phase` heading. If spec file not found or section not found, micro-review runs without spec context (logged as warning, not a failure). Micro-review prompt is scoped to: security vulnerabilities, performance regressions, scope drift vs spec section, pattern compliance. NOT "find all issues." If review returns critical issues (🔴), step fails.
- **Verify:** Run `verify-phase` on a phase with a known SQL injection pattern, confirm micro-review catches it.
- **Source:** `src/commands/verify-phase.ts`

#### UI Layer
N/A

#### API Layer
Calls the configured `reviews.code_reviewer` from `wm.yaml`, or falls back to a Claude API call if no reviewer is configured. Review is skipped (with warning) if no API key is available.

#### Data Layer
Micro-review result stored in phase evidence file alongside other step results.

---

### B5: tests_pass Is Now a Required Gate

**Core:**
- **ID:** stop-condition-tests-pass-required
- **Trigger:** Agent or human runs `kata can-exit` in implementation mode
- **Expected:** `can-exit` requires at least one `.claude/verification-evidence/phase-*-{issue}.json` file to exist with fresh timestamp and `overallPassed === true`. If no evidence files exist: gate fails with "verify-phase has not been run." If any existing file is stale (timestamp older than latest commit) or `overallPassed !== true`: exit blocked. Issue number is read from session state (`readState()`) — no manual flag needed in `can-exit`. Enforcement is via a new `checkTestsPass(issueNumber)` function in `can-exit.ts`, wired into `validateCanExit()` for `sessionType === 'implementation'`.
- **Verify:** Complete phase p1 with `verify-phase`, then make a new commit, run `kata can-exit`, confirm it blocks with "stale evidence" message. Re-run `verify-phase p1`, confirm gate passes.
- **Source:** `src/commands/can-exit.ts` — new `checkTestsPass()` function, called in `validateCanExit()` for implementation mode

#### UI Layer
N/A

#### API Layer
N/A

#### Data Layer
N/A — enforcement is in TypeScript, not a config file at runtime.

---

### B6: feature_tests_added Is a New Required Gate

**Core:**
- **ID:** stop-condition-feature-tests-added
- **Trigger:** Agent or human runs `kata can-exit` in implementation mode
- **Expected:** New condition `feature_tests_added` blocks exit if no new test function has been added during the session. Check: count of new `test(` / `it(` / `describe(` functions in staged/committed files vs `origin/main`. If zero new test functions: exit blocked with "At least one new test function is required per implementation session."
- **Verify:** Complete an implementation session with no new test files added, run `kata can-exit`, confirm blocked on `feature_tests_added`.
- **Source:** `src/commands/can-exit.ts` (new check function)

#### UI Layer
N/A

#### API Layer
N/A

#### Data Layer
New check logic added to `can-exit.ts`.

---

### B7: Verification Evidence Validates Timestamp Not Just File Existence

**Core:**
- **ID:** stop-condition-verification-timestamp-hardened
- **Trigger:** `kata can-exit` evaluates `checkVerificationEvidence()` condition
- **Expected:** Check reads `.claude/verification-evidence/{issue}.json`, validates `passed === true` AND `verifiedAt` timestamp is newer than the latest git commit timestamp. If evidence file exists with `passed: true` but timestamp predates the most recent commit: gate fails with "Verification evidence is stale (predates latest commit). Re-run your code reviewer."
- **Verify:** Run code reviewer to create evidence, make a commit, run `kata can-exit` — confirm gate fails due to stale timestamp. Re-run reviewer, confirm gate passes.
- **Source:** `src/commands/can-exit.ts` — `checkVerificationEvidence()` function

#### UI Layer
N/A

#### API Layer
N/A

#### Data Layer
`.claude/verification-evidence/{issue}.json` — reads `verifiedAt` field. Git: `git log -1 --format=%cI` for latest commit timestamp.

---

### B8: Implementation Template Per-Phase Loop Uses verify-phase

**Core:**
- **ID:** template-per-phase-loop-uses-verify-phase
- **Trigger:** Orchestrator follows the P2 Implement phase in `.claude/workflows/templates/implementation.md`
- **Expected:** The VERIFY sub-phase step references `kata verify-phase <phase-id>`. If command exits non-zero, orchestrator re-spawns impl agent with failure output as context. If exits zero, orchestrator proceeds to mark phase complete.
- **Verify:** Read updated `implementation.md`, confirm the VERIFY sub-phase step references `kata verify-phase`.
- **Source:** `.claude/workflows/templates/implementation.md` — VERIFY sub-phase step instructions

#### UI Layer
N/A

#### API Layer
N/A

#### Data Layer
N/A — documentation-only change

---

### B9: Spec Templates Include test_cases Scaffold

**Core:**
- **ID:** spec-template-test-cases-per-phase
- **Trigger:** New spec created from `planning/spec-templates/feature.md`
- **Expected:** Each implementation phase section in the spec template includes a `test_cases:` subsection with scaffold comments. When impl agent reads the spec section, it receives the test cases as input before writing production code.
- **Verify:** Open `planning/spec-templates/feature.md`, confirm each phase section contains `test_cases:` subsection.
- **Source:** `planning/spec-templates/feature.md`, `planning/spec-templates/bug.md`

#### UI Layer
N/A

#### API Layer
N/A

#### Data Layer
Template files updated. Existing specs unaffected (backward compatible).

---

## Scope

### In Scope
- New `kata verify-phase` command in `src/commands/verify-phase.ts`
- Wire `verify-phase` into `src/index.ts` CLI router
- New `checkTestsPass(issueNumber)` function in `can-exit.ts`, wired for implementation mode
- New `checkFeatureTestsAdded()` function in `can-exit.ts`
- Timestamp hardening in `checkVerificationEvidence()` in `can-exit.ts`
- Add `verification_stale` artifact type to `src/messages/stop-guidance.ts`
- Update `.claude/workflows/templates/implementation.md` VERIFY sub-phase step
- Add `test_cases:` scaffold to `planning/spec-templates/feature.md` and `planning/spec-templates/bug.md`

### Out of Scope
- Automatic retry protocol (re-spawn impl agent on failure) — tracked separately
- Mandatory TDD enforcement (deleting code written before tests) — too disruptive for MVP
- E2E tests in the inner loop — too slow for per-phase use
- Turbo/monorepo filtering — kata-wm is a single package

---

## Design

### verify-phase Command Architecture

```
kata verify-phase <phase-id> [--issue=N] [--force]

Steps (in order, fail-fast):
  1. build          npm run build                        (always runs)
  2. typecheck      npm run typecheck                    (always runs)
  3. tests          npm test                             (full suite — single package)
  4. smoke          node dist/index.js help              (fail if CLI broken)
  5. delta          git diff assertion count check       (fail if count decreases)
  6. micro-review   LLM on phase diff only              (scoped prompt)

Output:
  stdout: human-readable step results
  JSON:   .claude/verification-evidence/phase-<id>-<issue>.json (per-phase only)
          NOTE: does NOT touch .claude/verification-evidence/{issue}.json
                That file is owned by the configured code reviewer.
                can-exit reads phase-*.json files via checkTestsPass() separately.
  exit:   0 if all pass, 1 if any fail

Diff baseline: git diff origin/main...HEAD -- <changed-files>
  (three-dot diff: all changes since branch diverged from main)
```

### Per-Phase Loop After This Change

```
BEFORE (manual, memory-dependent):
  impl agent → run typecheck + tests manually → complete tasks

AFTER (automated, single command):
  impl agent → kata verify-phase <id> → [if pass] mark phase complete
                                       → [if fail] re-spawn impl agent with failure context
```

### Micro-Review Prompt Scope

The micro-review runs on phase diff only and uses a tightly scoped prompt:

```
Code passes its tests. Review this diff for:
1. Security vulnerabilities (injection, XSS, unvalidated input, secrets in code)
2. Performance regressions (blocking I/O in hot paths, excessive memory allocation)
3. Scope drift — does this diff implement what spec section says? Flag unrequested changes.
4. Pattern compliance — does this follow kata-wm patterns (src/ conventions)?

Do NOT flag style issues, naming preferences, or things covered by tests.
Return: PASS or FAIL with specific line references.
```

### Assertion Delta Check Algorithm

```
Baseline: origin/main...HEAD (all changes since branch diverged, including working tree)

1. Get changed test files: git diff --name-only origin/main...HEAD | grep -E '\.test\.ts$'
   Also include working tree changes: git diff --name-only | grep -E '\.test\.ts$'
2. For each changed test file, count assertions BEFORE (in origin/main):
   git show origin/main:<file> | grep -cE 'expect\(|assert\.|t\.is\(|\.toBe\(|\.toEqual\('
   If file is new (not in origin/main), treat before count as 0.
3. Count assertions AFTER: grep -cE 'expect\(|assert\.|t\.is\(|\.toBe\(|\.toEqual\(' <file> (working tree)
4. If sum(after) < sum(before): FAIL with delta report
5. Override: --force flag skips check with warning in evidence file
```

### feature_tests_added Check Algorithm

```
1. Get all files changed in this session vs origin/main: git diff --name-only origin/main
2. Filter to test files: grep -E '\.test\.ts$'
3. Count new test functions: git diff origin/main -- <test-files> | grep -cE '^\+(it|test|describe)\s*\('
4. If count === 0: FAIL with message "At least one new test function required"
```

---

## Implementation

### Phase 0: Baseline Verification (BLOCKING)

Before starting, verify these work:

| Check | How to Verify |
|-------|---------------|
| `kata can-exit` runs without errors | Run in implementation mode, observe output |
| `kata help` shows all existing commands | Run `kata help`, verify command list |
| `npm run build && npm test` passes on clean tree | Run and confirm green |
| `src/commands/can-exit.ts` can be read | `cat src/commands/can-exit.ts` |
| Spec template files exist | `ls planning/spec-templates/` |

**If any check fails:** STOP. Fix baseline first.

---

### Phase 1: verify-phase CLI Command

**Goal:** Create `kata verify-phase <phase-id>` that wraps all inner-loop verification steps.

**Files to create/change:**
- CREATE: `src/commands/verify-phase.ts`
- CHANGE: `src/index.ts` — add `verify-phase` case to switch, import

**Implementation tasks:**

1. Create `verify-phase.ts` with the following structure:
   - `parseArgs(args)` — parse `<phase-id>`, `--issue=N` (optional), `--force`, `--json`
   - `resolveIssueNumber(parsed)` — if `--issue=N` provided use it; otherwise read from session state via `getCurrentSessionId()` + `readState(getStateFilePath(sid))`, then use `state.issueNumber`. If still undefined: throw `Error('Issue number required. Pass --issue=<N> or link session: kata link <N>')`. Same pattern as existing `can-exit.ts` session state reading.
   - `runBuild()` — `execSync('npm run build')`, return `{name: 'build', passed, output}`
   - `runTypecheck()` — `execSync('npm run typecheck')`, return `{name: 'typecheck', passed, output}`
   - `runTests()` — `execSync('npm test')`, return `{name: 'tests', passed: exitCode === 0, output}`. Note: requires build to have run first (step 1 ensures this).
   - `runSmokeTest()` — `execSync('node dist/index.js help')`, if exit non-zero return `{name: 'smoke', passed: false, message: "CLI smoke test failed. Check build output: npm run build"}`
   - `runAssertionDelta(changedTestFiles, force)` — implement delta algorithm from Design section, return `{name: 'delta', passed, before, after, delta}`
   - `getSpecSection(issueNumber, phaseId)` — glob `planning/specs/<issueNumber>-*.md`, read file. Phase heading matching: try each variant in order until a match is found — `### Phase <phaseId>` (e.g., `p1`), `### Phase <n>` (numeric: `p1`→`1`). Regex: `/^###\s+Phase\s+(?:p?\d+|<phaseId>)[\s:]/im`. Extract text until the next `## ` or `### Phase` heading. Return extracted text or empty string if not found. If not found: log `[warn] spec section for phase ${phaseId} not found — micro-review runs without spec context` and continue (not a failure).
   - `runMicroReview(phaseId, issueNumber)` — call `getSpecSection()`. Changed files are `git diff --name-only origin/main...HEAD` filtered to exclude test files (`*.test.ts`) — micro-review is for production code only. Generate diff: `git diff origin/main...HEAD -- <non-test-files>`. If diff exceeds 500 lines: truncate with note "Diff truncated at 500 lines — review remaining files manually." Use the configured `reviews.code_reviewer` from `wm.yaml`, or skip with warning if none configured. Parse result for pass/fail: scan stdout for `🔴` anywhere in the output (fail). If review errors or times out: `{name: 'micro-review', passed: false, output: 'Review timed out or errored — re-run verify-phase to retry'}`. Return `{name: 'micro-review', passed: boolean, output: string}`.
   - `writeEvidenceFile(phaseId, issueNumber, steps)` — write per-phase file `.claude/verification-evidence/phase-<id>-<issue>.json`. Does NOT touch `{issue}.json`. Schema: `{ phaseId, issueNumber, timestamp: new Date().toISOString(), steps, overallPassed: steps.every(s => s.passed) }`
   - `verifyPhase(args)` — main export, orchestrates all steps fail-fast

2. Wire into `src/index.ts`:
   - Add `import { verifyPhase } from './commands/verify-phase.js'`
   - Add `case 'verify-phase': await verifyPhase(commandArgs); break;` to switch
   - Add `verify-phase <phase-id> [--issue=N] [--force]   Run per-phase verification` to `showHelp()`

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "verify-phase exits 0 when all steps pass"
    setup: "clean build, passing tests, no assertion delta decrease"
    command: "kata verify-phase p1 --issue=9999"
    expected_exit: 0
    expected_output_contains: ["build: PASS", "typecheck: PASS", "tests: PASS", "smoke: PASS", "delta: PASS"]

  - id: tc2
    description: "verify-phase exits 1 when build fails (fail-fast)"
    setup: "introduce syntax error in src/"
    command: "kata verify-phase p1"
    expected_exit: 1
    expected_output_contains: ["build: FAIL"]
    expected_output_not_contains: ["smoke:"]  # fail-fast: smoke not reached

  - id: tc3
    description: "verify-phase exits 1 when typecheck fails (fail-fast after build)"
    setup: "introduce TS type error"
    command: "kata verify-phase p1"
    expected_exit: 1
    expected_output_contains: ["typecheck: FAIL"]

  - id: tc4
    description: "assertion delta check fails when test count decreases"
    setup: "test file with 5 expect() calls reduced to 3"
    command: "kata verify-phase p1"
    expected_exit: 1
    expected_output_contains: ["delta: FAIL", "before: 5", "after: 3"]

  - id: tc5
    description: "--force flag bypasses assertion delta check with warning"
    setup: "test file with assertion count decrease"
    command: "kata verify-phase p1 --force"
    expected_exit: 0  # if other steps pass
    expected_output_contains: ["delta: SKIPPED (--force)"]

  - id: tc6
    description: "evidence file written to correct path"
    setup: "all steps pass"
    command: "kata verify-phase p1 --issue=3"
    expected: "file .claude/verification-evidence/phase-p1-3.json exists with overallPassed: true"

  - id: tc7
    description: "verify-phase appears in kata help"
    command: "kata help"
    expected_output_contains: ["verify-phase"]
```

**Acceptance criteria:**
- `kata verify-phase p1` runs all steps in sequence (build, typecheck, tests, smoke, delta, micro-review)
- Fail-fast: if step N fails, subsequent steps do not run (except `--force` for delta)
- Exit code 0 = all pass, exit code 1 = any fail
- Evidence file written on every run (pass or fail)
- `kata help` shows `verify-phase` in command list
- TypeScript compiles without errors (`npm run typecheck`)

---

### Phase 2: Stop Conditions Hardening

**Goal:** Make tests required, add `feature_tests_added`, harden verification timestamp check.

**Files to change:**
- `src/commands/can-exit.ts` — three new/updated check functions
- `src/messages/stop-guidance.ts` — add `'verification_stale'` artifact type

> **CRITICAL ARCHITECTURE NOTE:** `kata can-exit` does NOT read a JSON config file at runtime. All gate enforcement is via TypeScript functions in `can-exit.ts`, wired into `validateCanExit()`. The JSON verification evidence files provide state; logic lives in TS.

**Implementation tasks:**

1. In `src/commands/can-exit.ts`:

   a. **Update `checkVerificationEvidence()`**: After confirming `parsed.passed === true`, additionally check that `parsed.verifiedAt` timestamp is newer than latest git commit. Get latest commit time via `execSync('git log -1 --format=%cI')`. Parse both as Date objects. If evidence timestamp is older than latest commit: return `{ passed: false, artifactType: 'verification_stale' }`. Add `'verification_stale'` as a new case to `getArtifactMessage()` in `src/messages/stop-guidance.ts`.

   b. **Add `checkTestsPass(issueNumber)`**: Checks all phase evidence files that ALREADY EXIST.
      1. Glob `.claude/verification-evidence/phase-*-${issueNumber}.json` to find all existing phase evidence files
      2. If no phase evidence files exist: `{ passed: false, reason: 'verify-phase has not been run. Run: kata verify-phase <phaseId> --issue=${issueNumber}' }`
      3. For each evidence file found: verify `timestamp` is newer than `git log -1 --format=%cI` AND `overallPassed === true`
      4. If ANY existing phase file is stale OR `overallPassed !== true`: `{ passed: false, reason: 'Phase <phaseId> failed verify-phase or evidence is stale. Re-run: kata verify-phase <phaseId>' }`
      5. If all existing phase files are fresh and `overallPassed === true`: `{ passed: true }`

   c. **Add `checkFeatureTestsAdded()`**: Run `git diff --name-only origin/main` to get changed files, filter to `*.test.ts`. Count lines added matching `/^\+(it|test|describe)\s*\(` in `git diff origin/main -- <test-files>`. If count === 0: return `{ passed: false, newTestCount: 0 }`.

   d. **Wire both into `validateCanExit()`**: In the `sessionType === 'implementation'` block, after the existing `checkVerificationEvidence()` call, add:
   ```typescript
   const testsCheck = checkTestsPass(issueNumber)
   if (!testsCheck.passed) reasons.push(testsCheck.reason)

   const featureTestsCheck = checkFeatureTestsAdded()
   if (!featureTestsCheck.passed) reasons.push('At least one new test function required (it/test/describe). See: arXiv 2402.13521')
   ```

2. In `src/messages/stop-guidance.ts`: Add `'verification_stale'` case to `getArtifactMessage()`.

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "can-exit blocks when tests_pass not met (no verify-phase run)"
    setup: "implementation session, no phase evidence files"
    command: "kata can-exit"
    expected_exit: 1
    expected_output_contains: ["verify-phase has not been run"]

  - id: tc2
    description: "can-exit blocks when feature_tests_added not met"
    setup: "implementation session, verify-phase run, but no new test functions added"
    command: "kata can-exit"
    expected_exit: 1
    expected_output_contains: ["new test function required"]

  - id: tc3
    description: "can-exit blocks when verification evidence is stale"
    setup: "run code reviewer (creates evidence), make a commit, run can-exit"
    command: "kata can-exit"
    expected_exit: 1
    expected_output_contains: ["stale", "Verification evidence"]

  - id: tc4
    description: "can-exit passes when all conditions met"
    setup: "verify-phase passed, new test functions added, fresh verification evidence, no uncommitted changes"
    command: "kata can-exit"
    expected_exit: 0

  - id: tc5
    description: "TypeScript compiles after changes"
    command: "npm run typecheck"
    expected_exit: 0
```

**Acceptance criteria:**
- `feature_tests_added` condition blocks `kata can-exit` if no new test functions added
- `checkVerificationEvidence()` fails if evidence timestamp predates latest commit
- `verification_stale` artifact type exists in `stop-guidance.ts`
- `checkTestsPass()` requires at least one fresh phase evidence file
- TypeScript compiles without errors

---

### Phase 3: Per-Phase Loop Update (implementation.md template)

**Goal:** Update `.claude/workflows/templates/implementation.md` VERIFY sub-phase to use `kata verify-phase` and document `test_cases:` usage pattern for impl agents.

**Files to change:**
- `.claude/workflows/templates/implementation.md` — VERIFY sub-phase step instructions

**Implementation tasks:**

1. Update the VERIFY sub-phase step instructions. Replace the manual verification instructions with:

```markdown
### Run verify-phase

After the impl agent completes, run the automated verification:

```bash
kata verify-phase <phase-id> --issue=<NNN>
```

This runs all verification steps in sequence:
1. build — compile TypeScript (`npm run build`)
2. typecheck — type check without emit
3. tests — full test suite (`npm test`)
4. smoke — CLI smoke test (`node dist/index.js help`)
5. delta — assertion count check (gaming detection)
6. micro-review — scoped review on phase diff (security/perf/scope only)

**If verify-phase exits non-zero:** Re-spawn impl agent with the failure output as context:

```
Task(subagent_type="general-purpose", prompt="
FIX Phase X verification failure for GH#NNN

VERIFY-PHASE OUTPUT:
<paste verify-phase output>

FAILED STEP: [step name]

Fix the specific failure and return.
Do NOT rewrite other parts of the implementation.
")
```

Max 3 retry attempts. After 3 failures, stop and report to user.

**If verify-phase exits 0:** All steps passed. Mark phase complete.
```

2. Update the IMPL sub-phase step to include `test_cases:` reading instruction:

```markdown
REQUIREMENTS:
1. Read spec section thoroughly before coding
2. READ the `test_cases:` subsection of your spec phase BEFORE writing production code
   - These are the test cases you must make pass
   - Write tests alongside (or before) production code
3. Follow existing patterns in `src/`
4. Run: npm run build && npm run typecheck after each significant change
```

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "implementation.md VERIFY sub-phase references kata verify-phase"
    command: "grep 'kata verify-phase' .claude/workflows/templates/implementation.md"
    expected_exit: 0

  - id: tc2
    description: "implementation.md IMPL sub-phase instructs reading test_cases: before coding"
    command: "grep 'test_cases' .claude/workflows/templates/implementation.md"
    expected_exit: 0

  - id: tc3
    description: "retry protocol documented (max 3 attempts)"
    command: "grep -i 'max 3' .claude/workflows/templates/implementation.md"
    expected_exit: 0
```

**Acceptance criteria:**
- VERIFY sub-phase step in `implementation.md` references `kata verify-phase` (not manual commands)
- IMPL sub-phase prompt includes `test_cases:` reading instruction
- Retry protocol documented (max 3 attempts, escalate to user)

---

### Phase 4: Spec Template Update

**Goal:** Add `test_cases:` scaffold to spec templates so new specs are created with the right structure.

**Files to change:**
- `planning/spec-templates/feature.md`
- `planning/spec-templates/bug.md`

**Implementation tasks:**

In each template file, update every Implementation Phase section to include a `test_cases:` subsection after Tasks. The scaffold:

```markdown
### Phase 1: {Phase 1 Name}

Tasks:
- {Task 1}
- {Task 2}

test_cases:
- id: tc1
  description: "{What this test verifies}"
  command: "{Command to run or assertion to check}"
  expected_exit: 0
- id: tc2
  description: "{Edge case or error path}"
  command: "{Command}"
  expected_exit: 1

Verification:
- Feature works as expected
- Types compile (`npm run typecheck`)
- All test_cases pass (`npm run build && npm test`)
```

**test_cases:**

```yaml
test_cases:
  - id: tc1
    description: "feature.md has test_cases: scaffold in phase section"
    command: "grep 'test_cases:' planning/spec-templates/feature.md"
    expected_exit: 0

  - id: tc2
    description: "bug.md has test_cases: scaffold in phase section"
    command: "grep 'test_cases:' planning/spec-templates/bug.md"
    expected_exit: 0

  - id: tc3
    description: "test_cases: scaffold includes id, description, command, expected_exit"
    command: "grep -A5 'test_cases:' planning/spec-templates/feature.md"
    expected_output_contains: ["id:", "description:", "command:", "expected_exit:"]
```

**Acceptance criteria:**
- `planning/spec-templates/feature.md` has `test_cases:` in Implementation Phase sections
- `planning/spec-templates/bug.md` has `test_cases:` in Implementation Phase sections
- Scaffold shows required fields: `id`, `description`, `command`, `expected_exit`
- Existing phase structure preserved — `test_cases:` is additive

---

## Blast Radius Analysis

### Code Impact

| File | Change Type | Notes |
|------|-------------|-------|
| `src/commands/verify-phase.ts` | NEW | Core implementation |
| `src/index.ts` | CHANGE | Add import + switch case + help text |
| `src/commands/can-exit.ts` | CHANGE | Harden `checkVerificationEvidence()`, add `checkTestsPass()`, `checkFeatureTestsAdded()` |
| `src/messages/stop-guidance.ts` | CHANGE | Add `'verification_stale'` artifact type |
| `.claude/workflows/templates/implementation.md` | CHANGE | VERIFY sub-phase updated, IMPL sub-phase updated |
| `planning/spec-templates/feature.md` | CHANGE | Add `test_cases:` scaffold |
| `planning/spec-templates/bug.md` | CHANGE | Add `test_cases:` scaffold |

**No breaking changes to existing APIs.** The `verify-phase` command is additive. The stop-condition changes are behavioral — sessions that previously passed `can-exit` without running tests will now be blocked. This is intentional.

### Performance Considerations

`verify-phase` adds approximately 1-3 minutes per phase (build + typecheck + tests + smoke). This is the intended trade-off: slower per phase, fewer bugs accumulated across phases.

### Security Considerations

The assertion delta check reads git diff output — no external data sources. The micro-review sends diff content to the configured LLM — same as existing reviewer integration. No new attack surface.

---

## Decision Log

### Decision 1: Smoke Test Is CLI Health (Not Server Health)

**Date:** 2026-02-21
**Chose:** `node dist/index.js help` — confirm CLI starts and runs
**Over:** No smoke test (kata-wm is a CLI, not a server)
**Reason:** 31.7% of AI code fails at runtime despite passing typecheck. A CLI smoke test catches broken dist output, missing imports, and runtime crashes that typecheck cannot.

### Decision 2: Micro-Review Uses Configured Reviewer

**Date:** 2026-02-21
**Chose:** Use `reviews.code_reviewer` from `wm.yaml`, skip with warning if not configured
**Over:** Hardcoded reviewer
**Reason:** kata-wm is a generic package. Projects configure their own reviewers (Gemini, Codex, etc.). The verify-phase command respects that config.

### Decision 3: Tests Run Full Suite (Not Affected Files)

**Date:** 2026-02-21
**Chose:** `npm test` (full suite — single package)
**Over:** Filter to changed files only
**Reason:** kata-wm is a single package. Turbo-style filtering doesn't apply. Full suite is fast enough for per-phase use.

### Decision 4: Assertion Delta Uses Decrease-Only Threshold

**Date:** 2026-02-21
**Chose:** Fail only if assertion count decreases (not if unchanged)
**Over:** Fail if no new assertions added
**Reason:** Some phases add no new tests (e.g., pure refactor, config changes). Failing on zero-delta would create too many false positives. Decrease is the specific gaming signal.

### Decision 5: feature_tests_added Checks Session-Wide

**Date:** 2026-02-21
**Chose:** Gate checks all changes vs `origin/main` (session-wide)
**Over:** Per-phase check
**Reason:** Session-wide is simpler and still enforces the intent. Some phases may legitimately add no tests if another phase in the same session adds many.

---

## Related Work

- [baseplane#1554](https://github.com/baseplane-ai/baseplane/issues/1554) — original spec this adapts
- [arXiv 2402.13521 — TDD as input](https://arxiv.org/html/2402.13521v1) — tests as input +8-12pp
- [arXiv 2512.22387 — Reproducibility](https://arxiv.org/html/2512.22387) — 31.7% runtime failure
- [Spotify Honk](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) — dual-loop, abstracted verifiers
- `src/commands/can-exit.ts` — current exit gate logic
- `src/messages/stop-guidance.ts` — artifact message registry
- `.claude/workflows/templates/implementation.md` — current impl template
