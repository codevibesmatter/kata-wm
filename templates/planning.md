---
id: planning
name: "Planning Mode"
description: "Feature planning with research, spec writing, and review"
mode: planning
phases:
  - id: p0
    name: Research
    task_config:
      title: "P0: Research - understand the problem space"
      labels: [phase, phase-0, research]
  - id: p1
    name: Spec Writing
    task_config:
      title: "P1: Spec - write the feature specification"
      labels: [phase, phase-1, spec]
      depends_on: [p0]
  - id: p2
    name: Review
    task_config:
      title: "P2: Review - review and refine the spec"
      labels: [phase, phase-2, review]
      depends_on: [p1]
  - id: p3
    name: Finalize
    task_config:
      title: "P3: Finalize - approve and sync"
      labels: [phase, phase-3, finalize]
      depends_on: [p2]

global_conditions:
  - changes_committed
  - changes_pushed
---

# Planning Mode

You are in **planning** mode. Create a feature spec through research, writing, and review.

## P0: Research

Understand the problem space:
- Search the codebase for similar implementations
- Review existing documentation and rules
- Identify patterns to follow

## P1: Spec Writing

Write the feature specification:
- Define the problem and solution
- List implementation phases with tasks
- Include acceptance criteria

## P2: Review

Review and refine the spec:
- Check for completeness
- Verify file paths exist
- Ensure no placeholder text remains

## P3: Finalize

Approve the spec and sync:
- Mark spec status as approved
- Commit and push changes
- Update the tracking issue

## Stop Conditions

- Spec file exists and is complete
- Changes committed and pushed
