---
id: task
name: Task Mode
description: Combined planning + implementation for small tasks and chores
mode: task
workflow_prefix: "TK"

phases:
  # Phase 0: Quick Planning (5-10 min max)
  - id: p0
    name: Quick Planning
    task_config:
      title: "P0: Plan - context search, scope, approach (5-10 min)"
      labels: [phase, phase-0, planning]
    steps:
      - id: understand-task
        title: "Understand the task"
        instruction: |
          Read the user's request carefully.

          **Classify the work:**
          - [ ] Is this a chore? (refactoring, cleanup, config change)
          - [ ] Is this a small feature? (< 3 files, < 100 lines)
          - [ ] Is this a fix? (bug, typo, edge case)

          **If larger scope:** Consider switching to `mode.sh planning` instead.

      - id: context-search
        title: "Quick context search (3-5 min)"
        instruction: |
          Search for relevant context:

          ```bash
          # Similar code
          Task(subagent_type="Explore", prompt="Find similar implementations for {task}", model="haiku")

          # Relevant rules
          ls .claude/rules/ | xargs grep -l "{relevant-keyword}"

          # Past sessions (optional)
          .claude/skills/episodic-memory/scripts/em.sh search "{task keywords}"
          ```

          Document key findings (1-3 bullet points).

      - id: scope-and-approach
        title: "Define scope and approach"
        instruction: |
          Write a brief plan (3-5 lines max):

          **Scope:**
          - Files to touch: [list files]
          - What changes: [brief description]

          **Approach:**
          - Pattern to follow: [reference similar code or rule]
          - Order of changes: [1, 2, 3]

          **Out of scope:**
          - [what you're NOT doing]

          Then: Mark this task completed via TodoWrite

  # Phase 1: Implement
  - id: p1
    name: Implement
    task_config:
      title: "P1: Implement - make changes, test as you go"
      labels: [phase, phase-1, implementation]
      depends_on: [p0]
    steps:
      - id: make-changes
        title: "Make the changes"
        instruction: |
          Follow your approach from P0.

          **For each file:**
          1. Read the file first
          2. Make minimal, focused changes
          3. Run typecheck after significant edits: `pnpm typecheck`

          **Keep it simple:**
          - Don't over-engineer
          - Don't add features beyond scope
          - Don't refactor unrelated code

      - id: verify-as-you-go
        title: "Verify changes work"
        instruction: |
          After each logical change:

          ```bash
          pnpm typecheck    # Types pass?
          pnpm lint         # No lint errors?
          ```

          If tests exist for this area:
          ```bash
          pnpm test -- --grep "{relevant test}"
          ```

          Then: Mark this task completed via TodoWrite

  # Phase 2: Complete
  - id: p2
    name: Complete
    task_config:
      title: "P2: Complete - commit, push, verify"
      labels: [phase, phase-2, complete]
      depends_on: [p1]
    steps:
      - id: final-verification
        title: "Final verification"
        instruction: |
          ```bash
          pnpm typecheck    # Must pass
          pnpm lint         # Must pass
          git status        # Review changes
          git diff          # Sanity check
          ```

      - id: commit-and-push
        title: "Commit and push"
        instruction: |
          ```bash
          git add <files>
          git commit -m "type(scope): description"
          git push
          ```

          Commit message types:
          - `chore:` - maintenance, config, cleanup
          - `fix:` - bug fixes
          - `feat:` - small features
          - `refactor:` - code restructuring

          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed

workflow_id_format: "TK-{session_last_4}-{MMDD}"
---

# Task Mode

**For small tasks and chores** - combined planning + implementation in one flow.

## When to Use

- Chores (refactoring, cleanup, config changes)
- Small features (< 3 files, < 100 lines)
- Quick fixes (bugs, typos, edge cases)
- Changes that don't need a full spec

## When NOT to Use

- Features needing user interview → `mode.sh planning`
- Complex multi-file changes → `mode.sh planning`
- Work spanning multiple sessions → `mode.sh planning`
- Bugs needing investigation → `mode.sh bugfix`

## Flow

```
P0: Plan (5-10 min)
    ├── Understand task
    ├── Quick context search
    └── Scope + approach (3-5 lines)

P1: Implement
    ├── Make changes (minimal, focused)
    └── Verify as you go (typecheck, lint)

P2: Complete
    ├── Final verification
    └── Commit and push
```

## Commands

```bash
wm status                              # Check current mode and phase
wm can-exit                            # Check stop conditions
```

## Key Principle

**Do less, verify more.** Task mode is for quick, focused work - not sprawling changes.
