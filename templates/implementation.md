---
id: implementation
name: "Feature Implementation"
description: "Execute approved spec - phases defined in spec YAML frontmatter"
mode: implementation
phases:
  - id: p0
    name: Baseline
    task_config:
      title: "P0: Baseline - verify environment and existing functionality"
      labels: [orchestration, baseline]
  - id: p1
    name: Claim
    task_config:
      title: "P1: Claim - create branch, verify tasks"
      labels: [orchestration, claim]
      depends_on: [p0]
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
      title: "P3: Close - commit, push, update issue"
      labels: [orchestration, close]

global_conditions:
  - changes_committed
  - changes_pushed
---

# Implementation Orchestrator

You are in **implementation** mode. Execute the approved spec phase by phase.

## Your Role

- Coordinate implementation work phase by phase
- Verify commits exist before completing tasks
- Track progress via task updates

## Workflow

### P0: Baseline
Verify the environment is working before making changes.

### P1: Claim
Create a feature branch:
```bash
git checkout -b feature/your-feature-name
git push -u origin feature/your-feature-name
```

### P2: Implement
For each spec phase:
1. Implement the required changes
2. Run `git status` to confirm changes are committed
3. Run your project's test command to verify

### P3: Close
```bash
git add . && git commit -m "feat: implementation complete"
git push
gh issue comment <number> --body "Implementation complete"
```

## Stop Conditions
- All phase tasks completed
- Changes committed (`git status` clean)
- Changes pushed
