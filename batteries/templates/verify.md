---
id: verify
name: "Verification Plan Execution"
description: "Standalone VP execution with repair loop — run after implementation or task mode"
mode: verify
workflow_prefix: "VF"
reviewer_prompt: verify-fix-review

phases:
  - id: p0
    name: Setup
    task_config:
      title: "P0: Setup - determine VP source, read verification tools, prepare environment"
      labels: [orchestration, setup]
    steps:
      - id: determine-input
        title: "Determine VP input source"
        instruction: |
          Determine where the Verification Plan comes from. Check in order:

          **1. Issue spec (if --issue=N was provided):**
          ```bash
          ls planning/specs/ | grep "{issue-number}"
          ```
          Read the spec and extract the `## Verification Plan` section.
          Parse all `### VPn:` steps — each step has a title, commands to run,
          and expected outcomes to compare against.

          **2. Plan file (if a verify-plan.md exists in the workflow dir):**
          ```bash
          kata status  # check workflowDir
          cat {workflowDir}/verify-plan.md
          ```

          **3. Infer from git diff (default when no issue/plan):**
          ```bash
          git log --oneline -10
          git diff HEAD~1 --stat
          git diff HEAD~1
          ```
          Build VP steps from what changed:
          - VP1: Build/compile passes (run project build command)
          - VP2: Tests pass (run project test command)
          - VP3: Changed files are correct (read each changed file, check for bugs/regressions)
          - VP4: Changes match commit intent (does the diff match what the commit message says?)

          Document which input source you are using and list all VP step titles.
          Then: Mark this task completed via TaskUpdate

      - id: read-verification-tools
        title: "Read verification tools config"
        instruction: |
          Read the project's verification tools config:
          - `.kata/verification-tools.md` (or `.claude/workflows/verification-tools.md`)

          This file has the project's dev server command, API base URL, auth setup,
          database access, and key endpoints. Read it FIRST before executing any VP steps.

          If no verification-tools.md exists, check `wm.yaml` for `dev_server_command`.
          Then: Mark this task completed via TaskUpdate

      - id: start-dev-server
        title: "Start dev server and confirm health"
        instruction: |
          If `dev_server_command` is configured, start the dev server:
          ```bash
          # Example: npm run dev &
          # Wait for health endpoint to respond
          curl -s http://localhost:{PORT}/health || (sleep 2 && curl -s http://localhost:{PORT}/health)
          ```

          Confirm the server is healthy before proceeding.
          If no dev server is needed (e.g., CLI-only or library project), skip and mark complete.
          Then: Mark this task completed via TaskUpdate

  - id: p1
    name: Execute
    container: true
    task_config:
      title: "P1: Execute - run all VP steps"
      labels: [execution, vp-steps]
    steps:
      - id: expand-vp-steps
        title: "Expand VP steps as individual tasks"
        instruction: |
          **Note:** Verify mode is the one exception to the "no TaskCreate" rule.
          TaskCreate is used here intentionally to expand VP steps as trackable tasks.

          For each VP step found in P0, create a native task using TaskCreate:

          ```
          TaskCreate(
            subject="VP{N}: {step title}",
            description="Execute VP step {N}: {full step description with expected outcome}",
            activeForm="Running VP{N}: {step title}"
          )
          ```

          Create ALL step tasks before executing any of them.
          Then mark this expand task completed via TaskUpdate.

          Next: Work through each VP{N} task in order:
          1. Read the step's expected commands and outcomes
          2. Run the commands exactly as described
          3. Compare actual vs expected
          4. Record pass/fail with actual output in the task notes
          5. Mark the task completed

  - id: p2
    name: Fix Loop
    task_config:
      title: "P2: Fix Loop - repair failures and re-verify"
      labels: [execution, fix-loop]
      depends_on: [p1]
    steps:
      - id: check-failures
        title: "Check for VP failures"
        instruction: |
          Review results from P1. List all VP steps with their pass/fail status.

          If ALL VP steps passed: mark this task complete and proceed to P3.

          If any VP steps failed: proceed to fix-and-reverify below.
          Then: Mark this task completed via TaskUpdate

      - id: fix-and-reverify
        title: "Fix implementation and re-verify (max 3 cycles)"
        instruction: |
          For each failed VP step, run up to 3 fix cycles:

          **Each cycle:**
          1. **Diagnose** — read the error output carefully, identify root cause in implementation code
          2. **Fix** — make the minimal code change to fix the issue (edit implementation, NOT the VP steps)
          3. **Re-run** — re-execute the failed VP step exactly as originally specified
          4. **Record** — note pass/fail for this cycle

          **Hard rules:**
          - Fix the implementation code, NEVER modify VP steps — VP steps are the source of truth
          - Maximum 3 fix cycles per failed step
          - If still failing after 3 cycles: escalate to user (see below) before proceeding
          - Do not skip steps even if they seem unrelated to the failure

          **After 3 failed cycles — escalate:**

          AskUserQuestion(questions=[{
            question: "VP step {N} still failing after 3 fix attempts. How to proceed?",
            header: "VP Failure",
            options: [
              {label: "Accept and continue", description: "Record as FAILED and move to next step — I'll address it separately"},
              {label: "Open bug issue", description: "Create a GitHub issue for this failure, then continue"},
              {label: "Keep session open", description: "Stop here — I'll investigate manually before proceeding"}
            ],
            multiSelect: false
          }])

          If "Accept and continue": record as PERMANENTLY FAILED with full diagnosis, proceed.
          If "Open bug issue": `gh issue create --title "bug: VP{N} failure — {description}" --body "{diagnosis}"`, then proceed.
          If "Keep session open": stop. Do not mark the task complete.

          After fixing: commit code changes before writing evidence.
          ```bash
          git add {changed files}
          git commit -m "fix: {what was fixed to pass VP}"
          ```

          Then: Mark this task completed via TaskUpdate

  - id: p2-review
    name: Fix Review
    task_config:
      title: "P2-Review: Fix Review - review emergency fixes for regressions before committing evidence"
      labels: [review, fix-review]
      depends_on: [p2]
    steps:
      - id: check-fixes-made
        title: "Check if fixes were made during P2"
        instruction: |
          Check whether any fix commits were made during the VP repair loop:
          ```bash
          git log --oneline -10
          ```

          Look for commits matching the pattern `fix: {what was fixed to pass VP}` from P2.

          If NO fix commits were made (all VP steps passed in P1): mark this task AND
          the review task below as completed immediately — no review needed.

          If fixes WERE made: proceed to the review step below.
          Then: Mark this task completed via TaskUpdate

      - id: review-fixes
        title: "Review fix changes — {reviewers}"
        instruction: |
          Run all reviewers sequentially on fix commits made during the VP repair loop.

          First, identify fix commits from the repair loop:
          ```bash
          git log --oneline -20
          git diff {first-fix-sha}^..HEAD  # full diff of all fix commits
          ```

          **Reviewers to run: {reviewers}**

          1. Spawn review-agent:
          ```
          Task(subagent_type="review-agent", prompt="
            Review the fix changes made during VP failure resolution in verify mode.

            Identify fix commits: git log --oneline -20
            Review the diff: git diff {first-fix-sha}^..HEAD

            This review has a specific focus: HASTY-FIX RISK.
            Fixes made under pressure during verification often introduce regressions.
            Evaluate each changed file/function against these criteria:

            1. MINIMALITY — Is the fix narrowly targeted at the failing VP step?
               Red flag: changes to unrelated files, opportunistic refactoring, scope creep.
            2. ROOT CAUSE — Does the fix address the actual root cause, not just the symptom?
               Red flag: workarounds, special-casing the test scenario, suppressing errors.
            3. REGRESSION RISK — Could this fix break other VP steps or existing behavior?
               Red flag: changes to shared utilities, altered function signatures, changed defaults.
            4. CORRECTNESS — Is the logic sound? Edge cases handled?
               Red flag: off-by-one, null dereference, wrong condition direction.
            5. SIDE EFFECTS — Any unintended state changes, performance impact, or security concerns?

            Return verdict: APPROVE or REQUEST CHANGES.
            APPROVE: brief confirmation that fixes are clean and targeted.
            REQUEST CHANGES: specific issues at file:line with explanation of risk.
          ")
          ```

          2. Run each external provider from the task title in sequence:
          ```bash
          # run each `kata review --prompt=verify-fix-review --provider=<name>` listed in the task title
          ```

          Print each result as it completes.

          **If REQUEST CHANGES:** Fix the identified issues, commit the corrections, then
          re-run this review step.

          **If APPROVE from all reviewers:** Proceed to P3 Evidence.
          Then: Mark this task completed via TaskUpdate

  - id: p3
    name: Evidence
    task_config:
      title: "P3: Evidence - write VP evidence, commit, report results"
      labels: [orchestration, evidence]
      depends_on: [p2-review]
    steps:
      - id: write-evidence
        title: "Write VP evidence file"
        instruction: |
          Write VP evidence to `.kata/verification-evidence/` (or `.claude/verification-evidence/` for old layout).

          Filename convention (the `can-exit` check requires `vp-*-{issueNumber}.json`):
          - Issue-based: `vp-p{N}-{issueNumber}.json` (e.g. `vp-p1-42.json`)
          - Plan-file: `vp-task-{plan-name}.json`
          - Infer mode: `vp-infer-{HEAD-short-hash}.json`

          ```json
          {
            "issueNumber": {N},
            "timestamp": "{ISO-8601}",
            "mode": "issue | plan-file | infer",
            "steps": [
              {"id": "VP1", "description": "...", "passed": true, "actual": "..."},
              {"id": "VP2", "description": "...", "passed": false, "actual": "...", "expected": "..."}
            ],
            "fixCycles": 0,
            "allStepsPassed": true
          }
          ```

          Then: Mark this task completed via TaskUpdate

      - id: commit-evidence
        title: "Commit evidence and push"
        instruction: |
          Commit the VP evidence file:
          ```bash
          git add .kata/verification-evidence/ .claude/verification-evidence/
          git commit -m "chore(verify): VP evidence for issue #N — {PASSED|FAILED}"
          git push
          ```

          If any VP steps failed, note the failure summary in the commit message.
          Then: Mark this task completed via TaskUpdate

      - id: update-issue
        title: "Update GitHub issue with verification results"
        instruction: |
          If this is issue-based verification, comment on the issue:

          **If all passed:**
          ```bash
          gh issue comment {N} --body "## Verification Plan PASSED

          All VP steps executed and passed.

          | Step | Result |
          |------|--------|
          | VP1  | ✅ Passed |
          | VP2  | ✅ Passed |

          Evidence: \`.kata/verification-evidence/vp-p1-{N}.json\`"
          ```

          **If any failed:**
          ```bash
          gh issue comment {N} --body "## Verification Plan FAILED

          {N}/{total} VP steps failed after 3 fix cycles.

          | Step | Result | Notes |
          |------|--------|-------|
          | VP1  | ✅ Passed | |
          | VP2  | ❌ Failed | {diagnosis} |

          Implementation needs further work before this issue can close."
          ```

          If no issue number (infer/plan-file mode), skip this step.
          Then: Mark this task completed via TaskUpdate

      - id: report-results
        title: "Report verification results"
        instruction: |
          Summarize results to the user:
          - Input source: {issue spec | plan file | inferred from git diff}
          - Total VP steps: {count}
          - Passed: {count}
          - Failed: {count}
          - Fix cycles used: {count}

          **Final verdict:**
          - All passed → "✅ Verification Plan PASSED"
          - Any failed → "❌ Verification Plan FAILED — {list failing steps with diagnosis}"

          Then: Mark this task completed via TaskUpdate

global_conditions:
  - changes_committed
  - changes_pushed
---

# Verify Mode

You are in **verify** mode. Execute a Verification Plan and fix any failures.

## Your Role

- Execute VP steps literally as written — commands, expected outcomes, all of it
- Do NOT modify VP steps — they are the source of truth
- Fix implementation code if VP steps fail (never the VP steps themselves)
- Record all results as evidence and commit it

## Input Sources

Verify mode supports three input sources (checked in order):

1. **Issue spec** — `kata enter verify --issue=N` extracts VP from the spec's `## Verification Plan`
2. **Plan file** — reads `### VPn:` steps from a standalone markdown file
3. **Infer** — builds VP from git diff + commit messages (build, tests, code review, intent matching)

## Phase Flow

```
P0: Setup
    ├── Determine VP input source (issue / plan-file / infer)
    ├── Read verification-tools.md
    └── Start dev server, confirm health

P1: Execute (per VP step)
    ├── Expand VP steps as individual tasks
    ├── VP1: {step title}
    ├── VP2: {step title}
    └── ...VPn: {step title}

P2: Fix Loop
    ├── Check for failures from P1
    └── For each failure: diagnose → fix → re-verify (max 3 cycles)

P2-Review: Fix Review  (skip if no fixes were made)
    ├── Check if fix commits exist
    └── REVIEW Protocol: review-agent + external providers

P3: Evidence
    ├── Write VP evidence JSON
    ├── Commit evidence + push
    ├── Update GitHub issue (if issue-based)
    └── Report pass/fail results
```

## TaskCreate Exception

Verify mode is the **only mode** that uses `TaskCreate`. This overrides the standard
`task_rules` which say "Do NOT create new tasks with TaskCreate." In P1, VP steps are
expanded as individual tasks so each can be tracked and marked pass/fail independently.

## VP Step Execution Protocol

For each VP step:

1. **Read** the step instructions carefully — note commands AND expected outcomes
2. **Execute** each command exactly as described — do not "improve" or skip commands
3. **Compare** actual results to expected results — be precise, not approximate
4. **Record** pass/fail with actual output captured

### Rules

- Execute commands EXACTLY as written in the VP
- If a step requires the dev server, ensure it is running before executing
- Record ALL results, even failures — do not stop on first failure, complete all steps
- Never mark a step "passed" without actually running its commands

## Repair-Reverify Loop (P2)

If any VP step fails in P1:

1. **Diagnose** — read the error, identify the root cause in implementation code
2. **Fix** — make the minimal code change to address the root cause
3. **Re-run** — re-execute the failed VP step exactly as originally specified
4. **Max 3 cycles** — if still failing after 3 repair attempts, record as permanently failed

**Critical:** Fix the implementation, never the VP steps. VP steps encode what the feature
is supposed to do — they are correct by definition in this mode.

## REVIEW Protocol (P2-Review)

After fixing VP failures, a focused code review guards against regressions introduced under
pressure. This phase runs **only when fix commits were made** — it is skipped when all VP
steps pass in P1.

**Why this matters:** Emergency fixes during verification are high-risk. The pressure to get
VP steps passing can lead to symptom-masking, scope creep, or fragile workarounds. The review
specifically targets hasty-fix failure modes rather than general code style.

**Protocol:**

1. **Spawn review-agent** — subagent reviews fix diff with hasty-fix criteria:
   - Minimality (no scope creep)
   - Root cause (not symptom masking)
   - Regression risk (no collateral damage to other VP steps)
   - Correctness (logic sound, edge cases handled)
   - Side effects (no unintended state changes)
2. **External providers** — run `kata review --prompt=verify-fix-review --provider=<name>` for
   each configured reviewer (pre-expanded into the task title as `{reviewers}` at `kata enter` time)

**If REQUEST CHANGES:** fix the issues, commit, and re-run the review.
**If APPROVE:** proceed to P3 Evidence.

## Stop Conditions

- All VP steps executed and recorded
- Fix loop complete (all passing or max cycles reached)
- VP evidence file committed and pushed
- Results reported with pass/fail verdict
