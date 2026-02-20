---
id: flow-state
mode: flow-state
description: "DEPRECATED - Use research mode instead (skip optional phases)"
deprecated: true
redirect: research

phases: []

stopConditions:
  - id: changes_committed
    description: All changes committed to git
    required: true
    skip_if_no_edits: true
  - id: changes_pushed
    description: All commits pushed to remote
    required: true
    skip_if_no_edits: true
---

# Flow State Mode (DEPRECATED)

> **This mode is deprecated.** Use `research` mode instead and skip the optional codebase/external phases.
>
> All work benefits from minimal structure. Even simple tasks benefit from:
> - Knowing what type of work you're doing
> - Basic tracking of what happened
> - Clean exit conditions

## Migration

Instead of `flow-state`, use:

```bash
.claude/workflows/scripts/mode.sh research
# Skip the optional P1 (codebase) and P2 (external) phases as needed
```

Research mode provides lightweight structure for brainstorming:
- Scope definition (what questions to answer)
- Optional codebase exploration (skip if not needed)
- Optional external research (skip if not needed)
- Synthesis of findings
- Research findings document at the end
- Same commit/push requirements

## Why Deprecated

"Unstructured" mode became an escape hatch to avoid workflow discipline.
Every task benefits from at least:
- Clear intent (what kind of work)
- Minimal tracking (what happened)
- Exit condition (done when X)

Research mode with optional phases provides this minimal structure
while remaining lightweight for brainstorming and quick discussions.
