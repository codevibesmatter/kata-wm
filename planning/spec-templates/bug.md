---
initiative: {slug}
type: project
issue_type: bug
status: draft
priority: medium
github_issue: null
created: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
phases:
  - id: p1
    name: Reproduce & Investigate
    tasks:
      - "Reproduce bug and document exact steps"
      - "Identify root cause (file:line)"
  - id: p2
    name: Fix
    tasks:
      - "Implement minimal targeted fix"
      - "Add regression test"
  - id: p3
    name: Verify
    tasks:
      - "Verify fix resolves original bug"
      - "Confirm no regressions"
      - "Commit, push, close issue"
---

# Bug: {Short Description}

> GitHub Issue: [#{N}](https://github.com/{org}/{repo}/issues/{N})

## Summary

{1-2 sentences: what breaks, when it breaks, for whom.}

## Reproduction Steps

**Environment:** {dev / staging / production, OS, browser if relevant}
**User/Context:** {which user role, which state}

1. {Step 1}
2. {Step 2}
3. {Step 3}

**Expected:** {what should happen}
**Actual:** {what actually happens}

## Error Evidence

```
{Paste exact error message, stack trace, or console output here}
```

**Screenshot/recording:** {link or "N/A"}

## Impact

- **Severity:** {Critical / High / Medium / Low}
- **Frequency:** {Always / Sometimes / Rare}
- **Affected users:** {all / {role} users / specific scenario}
- **Workaround:** {exists: {description} / none}

## Root Cause (fill in after investigation)

**File:** {path/to/file.ts}:{line}
**Function/Component:** {name}
**Cause:** {description of what's wrong}

## Fix Approach

{Describe the minimal fix. What changes, why it fixes it, what risk it carries.}

## Regression Test

{Describe a test that would catch this bug if it regressed. Add to test file: {path}.}

## Implementation Phases

### Phase 1: Reproduce & Investigate

Tasks:
- Reproduce bug and document exact steps
- Identify root cause (file:line)

test_cases:
- id: tc1
  description: "Reproduction: bug is confirmed reproducible"
  command: "{command that triggers the bug}"
  expected_exit: 1

### Phase 2: Fix

Tasks:
- Implement minimal targeted fix
- Add regression test

test_cases:
- id: tc1
  description: "Fix: original bug no longer occurs"
  command: "{command that previously triggered the bug}"
  expected_exit: 0
- id: tc2
  description: "Regression: existing tests still pass"
  command: "{test command}"
  expected_exit: 0
