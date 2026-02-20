---
id: debug
name: Debug Mode
description: Systematic hypothesis-driven debugging with reproduction, root cause analysis, and fix
mode: debug
aliases: [investigate]

phases:
  - id: p0
    name: Reproduce & Map
    task_config:
      title: "P0: Reproduce - capture evidence, map affected system"
      labels: [phase, phase-0, reproduce]
    steps:
      - id: reproduce-bug
        title: "Reproduce the bug with evidence"
        instruction: |
          **BEFORE reading any code, capture evidence:**

          1. **Exact reproduction steps** (user, environment, actions)
          2. **Error messages** — copy verbatim
          3. **Stack traces** — copy in full
          4. **Unexpected vs expected** — write both explicitly

          Check logs if available:
          ```bash
          # Check application logs
          # Check browser console
          # Check network requests
          ```

          If it can't be reproduced: document the conditions and investigate
          the code path anyway using the reported error as the starting point.

          Document your reproduction and claim the issue:
          ```bash
          gh issue edit {N} --remove-label "status:todo" --add-label "status:in-progress"
          gh issue comment {N} --body "Reproduced: {steps}
          Error: {error message}"
          ```

          Then: Mark this task completed via TodoWrite

      - id: map-system
        title: "Map affected system BEFORE reading code"
        instruction: |
          **STOP. Do NOT read code yet.**

          Draw the system map for this bug:

          1. **Which layers are involved?**
             - Data layer (database, schema)
             - API layer (endpoints, services)
             - Frontend layer (components, state)
             - Infrastructure (background jobs, queues)

          2. **What's the data flow?**
             ```
             [Trigger] → [Component/Handler] → [Service] → [Data Store]
             ```
             Fill in specifics for THIS bug.

          3. **Where could the failure originate?**
             - Data layer (wrong/missing data)
             - API layer (wrong response, unhandled error)
             - Frontend layer (wrong rendering, stale state)

          Write your system map before proceeding.
          Then: Mark this task completed via TodoWrite

      - id: classify-bug
        title: "Classify bug type"
        instruction: |
          Determine the bug type:

          | Type | Symptoms |
          |------|----------|
          | Data bug | Wrong values, missing data, stale data |
          | Logic bug | Wrong calculation, wrong condition, off-by-one |
          | State bug | Works once but not twice, stale UI |
          | Async bug | Race condition, timing-dependent |
          | Config bug | Wrong env var, missing setting |
          | Integration bug | External API, schema mismatch |

          Your classification: **{type}**
          Reason: {why}

          Then: Mark this task completed via TodoWrite

  - id: p1
    name: Investigate
    task_config:
      title: "P1: Investigate - form hypotheses, trace code path"
      labels: [phase, phase-1, investigate]
      depends_on: [p0]
    steps:
      - id: form-hypotheses
        title: "Form 3 hypotheses (not just 1)"
        instruction: |
          List 3 possible root causes (ranked by likelihood):

          1. **Most likely:** {hypothesis} — because {reason}
          2. **Plausible:** {hypothesis} — because {reason}
          3. **Unlikely but worth checking:** {hypothesis}

          Start investigating hypothesis #1 first.
          Then: Mark this task completed via TodoWrite

      - id: trace-code-path
        title: "Trace the code path"
        instruction: |
          Spawn a debug-focused agent to trace the execution:

          Task(subagent_type="debug-agent", prompt="
            Trace the code path for this bug:
            Symptom: {exact error or behavior}
            Hypothesis: {your #1 hypothesis}

            Start from: {entry point — API route, UI event, job trigger}
            Follow the path through all layers.
            Find: where actual behavior diverges from expected.
            Read all relevant files IN FULL.
            Document: file:line of the likely cause.
          ")

          TaskOutput(task_id=..., block=true)

          Review agent findings. Does it confirm hypothesis #1?
          If no, investigate hypothesis #2.
          Then: Mark this task completed via TodoWrite

      - id: confirm-root-cause
        title: "Confirm root cause"
        instruction: |
          Once the cause is identified:

          **Root cause:** {file:line} — {description}

          **Why it causes the bug:**
          {explanation of the causal chain}

          **Scope check:**
          - Could this affect other code paths? {yes/no, where}
          - Is there a related bug nearby? {yes/no}

          Update GitHub issue with root cause finding:
          ```bash
          gh issue comment {N} --body "Root cause found: {file}:{line}
          {explanation}"
          ```

          Then: Mark this task completed via TodoWrite

  - id: p2
    name: Fix
    task_config:
      title: "P2: Fix - minimal targeted fix, no scope creep"
      labels: [phase, phase-2, fix]
      depends_on: [p1]
    steps:
      - id: implement-fix
        title: "Implement minimal fix"
        instruction: |
          Fix the root cause with the minimum change needed:
          - Fix the specific bug
          - Don't refactor surrounding code
          - Don't add unrelated improvements
          - If the fix is > 50 lines, question if it's really minimal

          After making the fix:
          ```bash
          git diff  # Review the change
          ```

          Then: Mark this task completed via TodoWrite

      - id: add-regression-guard
        title: "Add test or assertion to prevent regression"
        instruction: |
          If your project has tests:
          - Add a test case that reproduces the bug
          - Verify the test FAILS without the fix
          - Verify the test PASSES with the fix

          If no test infrastructure, add a code comment explaining the invariant.

          Then: Mark this task completed via TodoWrite

  - id: p3
    name: Verify
    task_config:
      title: "P3: Verify - confirm fix, check regressions, commit"
      labels: [phase, phase-3, verify]
      depends_on: [p2]
    steps:
      - id: verify-fix
        title: "Verify fix resolves the original bug"
        instruction: |
          Reproduce the original issue using your P0 steps.
          Confirm it no longer occurs.

          Run the test suite:
          ```bash
          # Run your project's tests
          # Run typecheck
          # Run lint
          ```

          Document: confirmed fixed ✓
          Then: Mark this task completed via TodoWrite

      - id: regression-check
        title: "Check for regressions"
        instruction: |
          Review the diff one more time:
          ```bash
          git diff HEAD
          ```

          Check: does the fix affect any other code paths?
          If yes, test those paths manually.

          Then: Mark this task completed via TodoWrite

      - id: commit-and-close
        title: "Commit fix and close issue"
        instruction: |
          Commit:
          ```bash
          git add {changed files}
          git commit -m "fix({scope}): {description}

          Root cause: {file}:{line} — {explanation}
          {If issue: Fixes #N}"
          git push
          ```

          Close GitHub issue:
          ```bash
          gh issue edit {N} --remove-label "status:in-progress" --add-label "status:done"
          gh issue close {N} --comment "Fixed in {commit-sha}.
          Root cause: {explanation}
          Fix: {what changed}"
          ```

          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed
---

# Debug Mode

Systematic, hypothesis-driven debugging. No guessing — reproduce first, hypothesize, trace, fix.

## Phase Flow

```
P0: Reproduce & Map
    ├── Capture exact error evidence
    ├── Map affected system layers
    └── Classify bug type

P1: Investigate
    ├── Form 3 hypotheses (ranked)
    ├── Trace code path (debug-agent)
    └── Confirm root cause

P2: Fix
    ├── Minimal targeted fix
    └── Regression test/guard

P3: Verify
    ├── Confirm original bug resolved
    ├── Check for regressions
    └── Commit + close issue
```

## Rules

- **Reproduce first** — never fix what you haven't reproduced
- **Map before reading** — understand the system before diving into code
- **Three hypotheses** — don't anchor on the first idea
- **Minimal fix** — fix the root cause, not symptoms
- **Regression guard** — leave a test so it can't come back silently
