---
id: session-discovery
name: Session Discovery
description: Determine session type from user intent and context
mode: null
trigger: session_start

phases:
  - id: p0
    name: Parse Intent
    description: Understand what user wants from first message

  - id: p1
    name: Link Issue
    description: Connect to GitHub issue if mentioned

  - id: p2
    name: Check Context
    description: Look for existing spec, tasks, issue type

  - id: p3
    name: Classify
    description: Determine type + subtype, load workflow template

intent_mapping:
  - patterns: ["plan feature", "design", "spec", "create spec"]
    type: planning.feature
    template: planning-feature.md

  - patterns: ["plan epic", "design epic", "break down"]
    type: planning.strategic
    template: null

  - patterns: ["implement", "build", "code", "execute"]
    type: implementation.feature
    template: implementation-feature.md

  - patterns: ["fix bug", "debug", "fix the"]
    type: implementation.bugfix
    template: implementation-bugfix.md

  - patterns: ["research", "explore", "investigate", "understand"]
    type: planning.research
    template: research.md

  - patterns: ["orchestrate", "multi-agent", "spawn sessions"]
    type: orchestrator
    template: orchestrator.md
---

# Session Discovery Process

Run this discovery process at session start to determine type and create phase tasks.

## D0: Parse First User Message

Understand what the user wants:

| User Says | Intent | Likely Type |
|-----------|--------|-------------|
| "plan feature X", "design", "spec" | Planning | planning.feature |
| "plan epic for Y" | Strategic planning | planning.strategic |
| "implement issue 123", "build", "code" | Implementation | implementation.feature |
| "fix the bug in Y", "debug" | Bug fix | implementation.bugfix |
| "research Z", "explore" | Research | planning.research |
| "orchestrate", "multi-agent" | Orchestration | orchestrator |

## D1: Link Issue If Applicable

```bash
# If user mentioned issue number, enter mode with issue
wm enter planning --issue=NNN
# or
wm enter implementation --issue=NNN

# This links the session and creates tasks from template
```

## D2: Check Existing Context

| What to Check | How | Implication |
|---------------|-----|-------------|
| Issue has approved spec? | `ls planning/specs/{issue}-*.md` | Ready for implementation |
| Issue has open tasks? | `wm status` | May be continuation |
| Issue type is Epic? | Check githubType in state | planning.strategic |
| Issue type is Bug? | Check githubType in state | implementation.bugfix |

## D3: Classify and Load Template

Based on D0-D2, determine type and subtype:

| Intent + Context | Session Type | Template |
|------------------|--------------|----------|
| Plan feature, no spec | planning.feature | `planning-feature.md` |
| Plan epic | planning.strategic | (create if needed) |
| Research/explore | planning.research | `research.md` |
| Implement with approved spec | implementation.feature | `implementation-feature.md` |
| Fix bug | implementation.bugfix | `implementation-bugfix.md` |
| Multi-agent coordination | orchestrator | `orchestrator.md` |

Then:
1. Set session type: `mode.sh <type>`
2. Read the appropriate template from `.claude/workflows/templates/`
3. Tasks are created automatically when entering mode via `wm enter`

## Quick Commands

```bash
# Check current session state
cat .claude/sessions/$(cat .claude/current-session-id)/state.json | jq

# Set session type after discovery
mode.sh planning

# Enter mode with issue
wm enter planning --issue=NNN

# List available templates
ls .claude/workflows/templates/
```
