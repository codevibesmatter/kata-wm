---
id: implementation
name: "Feature Implementation"
description: "Execute approved spec — claim branch, implement, review, close with PR"
mode: implementation
phases:
  - id: p0
    name: Baseline
    task_config:
      title: "P0: Baseline - verify environment, read spec, confirm approach"
      labels: [orchestration, baseline]
    steps:
      - id: read-spec
        title: "Read and understand the spec"
        instruction: |
          Find and read the approved spec:
          ```bash
          ls planning/specs/ | grep "{issue-number or keyword}"
          ```

          Read the spec IN FULL. Understand:
          - All behaviors (B1, B2, ...) and their acceptance criteria
          - All implementation phases and their tasks
          - Non-goals (what NOT to do)

          If no spec exists, ask user for the spec file location.
          Then: Mark this task completed via TodoWrite

      - id: verify-environment
        title: "Verify dev environment is working"
        instruction: |
          Run sanity checks before making any changes:
          ```bash
          # Check types pass on clean tree
          # (use your project's typecheck command)
          git status  # Should be clean
          git log --oneline -3  # Confirm you're on the right branch
          ```

          Document: current branch, any pre-existing issues.
          Then: Mark this task completed via TodoWrite

  - id: p1
    name: Claim
    task_config:
      title: "P1: Claim - create branch, link GitHub issue"
      labels: [orchestration, claim]
      depends_on: [p0]
    steps:
      - id: create-branch
        title: "Create feature branch"
        instruction: |
          Create a branch for this work:
          ```bash
          git checkout -b feature/{issue-number}-{slug}
          git push -u origin feature/{issue-number}-{slug}
          ```

          Or if already on a feature branch, confirm it's up to date:
          ```bash
          git fetch origin
          git status
          ```

          Then: Mark this task completed via TodoWrite

      - id: claim-github-issue
        title: "Claim GitHub issue"
        instruction: |
          If GitHub issue exists, claim it:
          ```bash
          gh issue edit {N} --remove-label "status:todo" --remove-label "approved" --add-label "status:in-progress"
          gh issue comment {N} --body "Starting implementation on branch: feature/{issue-number}-{slug}"
          ```

          If no GitHub issue, skip this step.
          Then: Mark this task completed via TodoWrite

  - id: p2
    name: Implement
    container: true
    subphase_pattern:
      - id_suffix: impl
        title_template: "IMPL - {task_summary}"
        todo_template: "Implement {task_summary}"
        active_form: "Implementing {phase_name}"
        labels: [impl]
      - id_suffix: verify
        title_template: "VERIFY - {phase_name}"
        todo_template: "Verify {phase_name} implementation"
        active_form: "Verifying {phase_name}"
        labels: [verify]
        depends_on_previous: true

  - id: p3
    name: Close
    task_config:
      title: "P3: Close - final checks, commit, PR, close issue"
      labels: [orchestration, close]
      depends_on: [p2]
    steps:
      - id: final-checks
        title: "Run final checks"
        instruction: |
          Before closing:
          ```bash
          git status          # All changes staged?
          git diff --staged   # Review what's being committed
          ```

          Run your project's test and typecheck commands.
          Fix any remaining issues.
          Then: Mark this task completed via TodoWrite

      - id: commit-and-push
        title: "Commit and push all changes"
        instruction: |
          Commit all implementation work:
          ```bash
          git add {changed files}
          git commit -m "feat({scope}): {description}

          Implements #{github-issue-number}"
          git push
          ```

          Then: Mark this task completed via TodoWrite

      - id: create-pr
        title: "Create pull request"
        instruction: |
          Create a PR:
          ```bash
          gh pr create \
            --title "feat: {feature title} (#N)" \
            --body "## Summary
          - {bullet 1}
          - {bullet 2}

          ## Changes
          - {file/component}: {what changed}

          Closes #{N}" \
            --base main
          ```

          Note the PR URL. Move issue to in-review:
          ```bash
          gh issue edit {N} --remove-label "status:in-progress" --add-label "status:in-review"
          ```

          Then: Mark this task completed via TodoWrite

      - id: close-issue
        title: "Update GitHub issue"
        instruction: |
          If GitHub issue exists:
          ```bash
          gh issue comment {N} --body "Implementation complete. PR: {pr-url}"
          ```

          The issue will auto-close when PR is merged ("Closes #N" in PR body).
          On merge, add status:done:
          ```bash
          gh issue edit {N} --remove-label "status:in-review" --add-label "status:done"
          ```
          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed
---

# Implementation Mode

You are in **implementation** mode. Execute the approved spec phase by phase.

## Your Role

- Read and understand the spec before writing any code
- Implement each spec phase completely before moving to the next
- Verify after each phase (typecheck, tests, git status)
- Track progress via task updates (TodoWrite)

## Phase Flow

```
P0: Baseline
    ├── Read spec IN FULL
    └── Verify environment is clean

P1: Claim
    ├── Create feature branch
    └── Claim GitHub issue

P2: Implement (per-spec-phase)
    ├── IMPL: implement the phase tasks
    └── VERIFY: run checks, confirm behavior

P3: Close
    ├── Final typecheck + tests
    ├── Commit + push
    ├── Create PR
    └── Comment on GitHub issue
```

## Key Rules

- **Read spec first** — understand ALL phases before writing code
- **One phase at a time** — complete IMPL + VERIFY before moving on
- **No scope creep** — spec's non-goals are off-limits
- **Commit per phase** — smaller commits, easier review

## Stop Conditions

- All spec phases implemented and verified
- Changes committed and pushed
- PR created (or explicitly skipped)
