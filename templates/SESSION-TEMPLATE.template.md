---
# SESSION TEMPLATE: TEMPLATE
#
# META-TEMPLATE for creating new session templates.
# Copy this file to `{mode-type}.md` and customize.
# All session templates MUST follow this structure.

# ============================================================================
# REQUIRED FRONTMATTER
# ============================================================================

id: {{MODE_ID}}                     # Unique identifier: {type}-{subtype} or {type}
name: {{MODE_NAME}}                 # Human-readable name
description: {{MODE_DESCRIPTION}}   # One-line description of what this mode is for
mode: {{MODE_TYPE}}                 # Mode identifier (flat, matches stop-conditions.json)

# ============================================================================
# PHASES
# ============================================================================
# Each phase defines a step in the workflow.
# Phases are processed in order.
# Each phase can create a bead for tracking.

phases:
  # --- DISCOVERY PHASE (stop hook OFF) ---
  # These phases allow exploration without blocking exit.
  # User can leave at any time during discovery.

  - id: {{PHASE_1_ID}}              # Unique within this template
    name: {{PHASE_1_NAME}}          # Human-readable name
    task_config:
      title: "P0: {{PHASE_1_TITLE}}"
      labels: [phase, phase-0, {{PHASE_1_ID}}, discovery]
    stop_hook: off                  # "off" = can exit without completing
    conditions: []                  # No conditions for discovery phases

  - id: {{PHASE_2_ID}}
    name: {{PHASE_2_NAME}}
    task_config:
      title: "P1: {{PHASE_2_TITLE}}"
      labels: [phase, phase-1, {{PHASE_2_ID}}, discovery]
      depends_on: [{{PHASE_1_ID}}]  # Dependencies on previous phases
    stop_hook: off
    conditions: []

  # --- APPROVAL GATE ---
  # Separates discovery from execution.
  # After this gate, stop hook activates.

  - id: approved
    name: User Approval
    task_config:
      title: "GATE: Approved by user"
      labels: [phase, gate, approval]
      depends_on: [{{PHASE_2_ID}}]
    stop_hook: off                  # Still off - stop hook activates AFTER this closes
    conditions:
      - user_approved

  # --- EXECUTION PHASE (stop hook ON) ---
  # These phases require completion before exit.
  # Stop hook blocks exit until conditions met.

  - id: {{PHASE_3_ID}}
    name: {{PHASE_3_NAME}}
    task_config:
      title: "P2: {{PHASE_3_TITLE}}"
      labels: [phase, phase-2, {{PHASE_3_ID}}, execution]
      depends_on: [approved]
    conditions:                     # Conditions that must be met to complete phase
      - {{CONDITION_TYPE}}: {{CONDITION_VALUE}}

  - id: {{PHASE_4_ID}}
    name: {{PHASE_4_NAME}}
    task_config:
      title: "P3: {{PHASE_4_TITLE}}"
      labels: [phase, phase-3, {{PHASE_4_ID}}, execution]
      depends_on: [{{PHASE_3_ID}}]
    conditions:
      - {{CONDITION_TYPE}}: {{CONDITION_VALUE}}

# ============================================================================
# GLOBAL CONDITIONS
# ============================================================================
# These conditions must be met for ANY exit, regardless of phase.

global_conditions:
  - changes_committed               # All edits committed to git
  - changes_pushed                  # All commits pushed to remote

# ============================================================================
# WORKFLOW ID FORMAT
# ============================================================================
# How to generate workflow IDs for this mode.
# Variables: {session_last_4}, {MMDD}, {issue}, {type_prefix}

workflow_id_format: "{{TYPE_PREFIX}}-{session_last_4}-{MMDD}"

---

# {{MODE_NAME}}

<!--
  SESSION TEMPLATE STRUCTURE REQUIREMENTS:

  1. FRONTMATTER: YAML block defining phases and conditions (above)

  2. GUIDANCE SECTIONS: Markdown below the frontmatter provides
     human-readable guidance for each phase.

  3. PHASE DOCUMENTATION: Each phase from frontmatter should have
     a corresponding section explaining:
     - What to do
     - How to verify completion
     - Common patterns/anti-patterns

  4. TOOLS & COMMANDS: Include relevant commands for each phase

  5. STOP CONDITIONS: Document what blocks session exit
-->

## Overview

[What is this session mode for? When should it be used?]

## Phases

### Phase 0: {{PHASE_1_NAME}}

**Purpose:** [What this phase accomplishes]

**Actions:**
- [ ] Action 1
- [ ] Action 2

**Completion:** [How to know this phase is done]

### Phase 1: {{PHASE_2_NAME}}

**Purpose:** [What this phase accomplishes]

**Actions:**
- [ ] Action 1
- [ ] Action 2

**Completion:** [How to know this phase is done]

### GATE: Approval

**Purpose:** User confirms direction before execution phase begins.

After this gate closes, stop hook activates. Session cannot end until execution phases complete.

### Phase 2: {{PHASE_3_NAME}}

**Purpose:** [What this phase accomplishes]

**Actions:**
- [ ] Action 1
- [ ] Action 2

**Completion:** [How to know this phase is done]

### Phase 3: {{PHASE_4_NAME}}

**Purpose:** [What this phase accomplishes]

**Actions:**
- [ ] Action 1
- [ ] Action 2

**Completion:** [How to know this phase is done]

---

## Tools & Commands

```bash
# Phase-specific commands
.claude/workflows/scripts/advance-phase.sh {{PHASE_1_ID}}
.claude/workflows/scripts/advance-phase.sh {{PHASE_2_ID}}
# etc.
```

## Stop Conditions

This session type requires before exit:
- [ ] All execution phases complete
- [ ] Changes committed
- [ ] Changes pushed
- [ ] [Type-specific conditions]

Check with: `.claude/workflows/scripts/mode.sh --can-exit`

---

## Condition Types Reference

Available condition types for phases:

| Condition | Description | Example |
|-----------|-------------|---------|
| `user_approved` | User explicitly approved | `- user_approved` |
| `file_exists` | File at path exists | `file_exists: "planning/specs/{issue}-*.md"` |
| `codex_passed` | Codex review passed (no 🔴, ≤2 🟡) | `- codex_passed` |
| `tasks_created` | Implementation tasks exist | `- tasks_created` |
| `tests_pass` | Test suite passes | `- tests_pass` |
| `typecheck_pass` | TypeScript passes | `- typecheck_pass` |
