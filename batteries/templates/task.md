---
id: task
name: Task Mode
description: Combined planning + implementation for small tasks, chores, and quick fixes
mode: task
workflow_prefix: "TK"

phases:
  - id: p0
    name: Quick Planning
    task_config:
      title: "P0: Plan - scope, approach, GitHub link (5-10 min)"
      labels: [phase, phase-0, planning]
    steps:
      - id: understand-task
        title: "Understand and classify the task"
        instruction: |
          Read the user's request carefully.

          **Classify:**
          - [ ] Chore — refactoring, cleanup, config change, docs
          - [ ] Small feature — < 3 files, < 100 lines
          - [ ] Fix — bug, typo, edge case
          - [ ] Chore with GitHub issue

          **If larger scope detected:** Tell the user and suggest:
          `wm enter planning` for full spec
          `wm enter implementation` if spec exists

          **GitHub issue?**
          ```bash
          gh issue list --search "{task description}" --limit 3
          ```
          Note issue # if found.

      - id: context-search
        title: "Quick context search (3-5 min max)"
        instruction: |
          Find relevant context fast:

          Task(subagent_type="Explore", prompt="
            Find code related to {task description}.
            Search: Glob + Grep for relevant files.
            Document: file:line references, patterns to follow.
            Keep it brief — 3-5 findings max.
          ", model="haiku")

          Also check rules if relevant:
          ```bash
          ls .claude/rules/ | xargs grep -l "{keyword}" 2>/dev/null
          ```

          TaskOutput(task_id=..., block=true)
          Then: Mark this task completed via TodoWrite

      - id: scope-and-approach
        title: "Define scope and approach"
        instruction: |
          Write a brief plan (3-5 lines):

          **Files to change:**
          - {file path}: {what changes}

          **Approach:**
          - Follow pattern from: {file:line reference}
          - Order: {step 1}, {step 2}

          **Out of scope:**
          - {what NOT to do}

          **GitHub:** #{issue-number} or "no issue"

          If GitHub issue found, claim it:
          ```bash
          gh issue edit {N} --remove-label "status:todo" --add-label "status:in-progress"
          ```

          Then: Mark this task completed via TodoWrite

  - id: p1
    name: Implement
    task_config:
      title: "P1: Implement - make changes, verify as you go"
      labels: [phase, phase-1, implementation]
      depends_on: [p0]
    steps:
      - id: make-changes
        title: "Make the changes"
        instruction: |
          Follow your plan from P0. For each file:
          1. Read the file first
          2. Make minimal, focused changes
          3. Run typecheck/lint after significant edits

          **Keep it simple:**
          - No over-engineering
          - No features beyond scope
          - No unrelated refactoring

      - id: verify-as-you-go
        title: "Verify after each logical change"
        instruction: |
          After each change:
          ```bash
          # Run your project's typecheck command
          # Run relevant tests if they exist
          git diff  # Review what changed
          ```

          If tests exist for this area, run them:
          ```bash
          # Run tests matching the changed area
          ```

          Then: Mark this task completed via TodoWrite

  - id: p2
    name: Complete
    task_config:
      title: "P2: Complete - final checks, commit, push, close issue"
      labels: [phase, phase-2, complete]
      depends_on: [p1]
    steps:
      - id: final-verification
        title: "Final verification"
        instruction: |
          ```bash
          # Run typecheck
          # Run lint
          git status          # Review all changes
          git diff --staged   # Confirm staged changes look right
          ```

      - id: commit-and-push
        title: "Commit, push, close issue"
        instruction: |
          Commit:
          ```bash
          git add {changed files}
          git commit -m "type(scope): description

          {If GitHub issue: Refs #N}"
          git push
          ```

          Commit types: `chore:` `fix:` `feat:` `refactor:` `docs:` `test:`

          **If GitHub issue:**
          ```bash
          gh issue edit {N} --remove-label "status:in-progress" --add-label "status:done"
          gh issue comment {N} --body "Done. Commit: {commit-sha}"
          # Close if fully resolved:
          gh issue close {N} --comment "Resolved in {commit-sha}"
          ```

          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed

workflow_id_format: "TK-{session_last_4}-{MMDD}"
---

# Task Mode

**For small tasks and chores** — combined planning + implementation in one flow.

## When to Use

- Chores (refactoring, cleanup, config, docs)
- Small features (< 3 files, < ~100 lines)
- Quick fixes (bugs, typos, edge cases)
- Work that doesn't need a full spec

## When NOT to Use

- Features needing full design → `wm enter planning`
- Complex multi-file changes → `wm enter planning`
- Bugs needing systematic investigation → `wm enter debug`
- Work spanning multiple sessions → `wm enter planning`

## Flow

```
P0: Plan (5-10 min)
    ├── Classify: chore / feature / fix
    ├── Quick context search (Explore agent)
    └── 3-5 line scope + approach

P1: Implement
    ├── Make minimal, focused changes
    └── Verify as you go (typecheck, tests)

P2: Complete
    ├── Final checks
    ├── Commit + push
    └── Close GitHub issue (if any)
```

## Key Principle

**Do less, verify more.** Task mode is for focused, bounded work.
