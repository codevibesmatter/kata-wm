# Session Templates

Mode-specific templates that define phases, conditions, and guidance for Claude Code sessions.

## Template Types

| Template | Mode | Use For |
|----------|------|---------|
| `planning-feature.md` | planning | Feature specs, design |
| `implementation-feature.md` | implementation | Building approved features |
| `implementation-bugfix.md` | bugfix | Fixing bugs |
| `orchestrator.md` | orchestrator | Multi-agent orchestration |
| `planning-research.md` | research | Exploration, learning |
| `session-discovery.md` | discovery | Initial issue discovery |
| `doctrine.md` | doctrine | Deep interview on theory/patterns docs |
| `calibration.md` | calibration | Multi-signal review (5 signals × 6 layers) |

## Creating a New Session Template

1. Copy `SESSION-TEMPLATE.template.md` to `{mode-type}.md`
2. Update frontmatter (id, name, mode, phases)
3. Define phases with tasks and conditions
4. Add markdown guidance for each phase
5. Document stop conditions

## Required Structure

All session templates MUST have:

### 1. YAML Frontmatter

```yaml
---
id: {mode-type}                   # Unique identifier
name: {Human Name}                # Display name
description: {One-line desc}      # What this mode is for
mode: {type}                      # Mode identifier (flat, matches stop-conditions.json)

phases:
  # Discovery phases (stop_hook: off)
  - id: phase_id
    name: Phase Name
    task_config:
      title: "P0: Phase title"
      labels: [phase, phase-0, discovery]
    stop_hook: off
    conditions: []

  # Approval gate
  - id: approved
    name: User Approval
    task_config:
      title: "GATE: Approved by user"
      labels: [phase, gate, approval]
    stop_hook: off
    conditions:
      - user_approved

  # Execution phases (conditions required)
  - id: execution_phase
    name: Execution Phase
    task_config:
      title: "P2: Phase title"
      labels: [phase, phase-2, execution]
      depends_on: [approved]
    conditions:
      - condition_type: value

global_conditions:
  - changes_committed
  - changes_pushed

workflow_id_format: "XX-{session_last_4}-{MMDD}"
---
```

### 2. Phase Documentation

Each phase in frontmatter should have a corresponding markdown section:

```markdown
### Phase N: Name

**Purpose:** What this phase accomplishes

**Actions:**
- [ ] Action 1
- [ ] Action 2

**Completion:** How to verify done
```

### 3. Tools & Commands

Include relevant commands for each phase.

### 4. Stop Conditions

Document what blocks session exit.

## Phase Design Principles

### Discovery vs Execution

| Phase Type | stop_hook | Exit Behavior |
|------------|-----------|---------------|
| Discovery | `off` | Can exit anytime |
| Gate | `off` | Marks transition point |
| Execution | (default on) | Must complete to exit |

### Approval Gates

- Place between discovery and execution
- User must explicitly approve
- Stop hook activates AFTER gate closes

### Conditions

| Condition | Description |
|-----------|-------------|
| `user_approved` | User explicitly approved |
| `file_exists: path` | File at path exists |
| `codex_score: N` | Codex review >= N |
| `tasks_created` | Implementation tasks exist |
| `tests_pass` | Test suite passes |
| `typecheck_pass` | TypeScript passes |

## Workflow ID Formats

| Mode | Format | Example |
|------|--------|---------|
| planning | `PL-{last4}-{MMDD}` | PL-a1b2-0104 |
| implementation | `IM-{last4}-{MMDD}` | IM-c3d4-0104 |
| debug | `DB-{last4}-{MMDD}` | DB-e5f6-0104 |
| research | `RS-{last4}-{MMDD}` | RS-g7h8-0104 |
| orchestrator | `OR-{last4}-{MMDD}` | OR-i9j0-0104 |
