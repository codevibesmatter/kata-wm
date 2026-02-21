---
initiative: {slug}
type: project
issue_type: feature
status: draft
priority: medium
github_issue: null
created: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
phases:
  - id: p1
    name: "{Phase 1 Name}"
    tasks:
      - "{Task 1}"
      - "{Task 2}"
  - id: p2
    name: "{Phase 2 Name}"
    tasks:
      - "{Task 1}"
      - "{Task 2}"
---

# {Feature Title}

> GitHub Issue: [#{N}](https://github.com/{org}/{repo}/issues/{N})

## Overview

{1-3 sentences: what problem this solves, for whom, and why now.}

## Feature Behaviors

### B1: {Behavior Name}

**Core:**
- **ID:** {kebab-case-id}
- **Trigger:** {what causes this — user action, API call, event}
- **Expected:** {what must happen}
- **Verify:** {how to confirm it works — specific test or observation}
- **Source:** {file:line if modifying existing code}

#### UI Layer

{What the user sees — component name, state changes, error messages. Or "N/A" if backend only.}

#### API Layer

{Endpoint, method, request body shape, response shape, error codes. Or "N/A" if frontend only.}

#### Data Layer

{Schema changes, new fields, migrations needed. Or "N/A" if no data changes.}

---

### B2: {Behavior Name}

**Core:**
- **ID:** {kebab-case-id}
- **Trigger:** {trigger}
- **Expected:** {expected}
- **Verify:** {verify}

#### UI Layer
{...}

#### API Layer
{...}

#### Data Layer
{...}

---

## Non-Goals

Explicitly out of scope for this feature:
- {thing we are NOT doing}
- {thing we are NOT doing}

## Open Questions

- [ ] {question that needs an answer before implementation}
- [ ] {question}

## Implementation Phases

See YAML frontmatter `phases:` above. Each phase should be 1-4 hours of focused work.

### Phase 1: {Phase 1 Name}

Tasks:
- {Task 1}
- {Task 2}

test_cases:
- id: tc1
  description: "{What this test verifies}"
  command: "{Command to run}"
  expected_exit: 0
- id: tc2
  description: "{Edge case or error path}"
  command: "{Command}"
  expected_exit: 1

Verification:
- Feature works as expected
- Types compile (`npm run typecheck`)
- All test_cases pass

### Phase 2: {Phase 2 Name}

Tasks:
- {Task 1}
- {Task 2}

test_cases:
- id: tc1
  description: "{What this test verifies}"
  command: "{Command to run}"
  expected_exit: 0

Verification:
- Feature works as expected
- Types compile (`npm run typecheck`)
- All test_cases pass

---

<!-- Copy this template for each new feature. Fill in ALL {placeholder} values.
     No placeholder text should remain in an approved spec. -->
