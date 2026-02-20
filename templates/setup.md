---
id: setup
name: "Project Setup Interview"
description: "Configure wm for a new project via guided interview"
category: system
phases:
  - id: bootstrap
    name: "Bootstrap"
    description: "Create .claude/ directory and verify prerequisites"
    tasks:
      - "Verify Node.js >= 18 is installed"
      - "Create .claude/ directory if it does not exist"
      - "Check if wm is already configured (wm.yaml exists)"
  - id: project-discovery
    name: "Project Discovery"
    description: "Auto-detect project settings and ask for confirmation"
    tasks:
      - "AskUserQuestion: Detect project name from package.json — is '{detected_name}' correct?"
      - "AskUserQuestion: Detected test command '{test_command}' — accept or override?"
      - "AskUserQuestion: Detected CI system '{ci_system}' — accept or override?"
  - id: review-cycle
    name: "Review Configuration"
    description: "Configure code review and spec review settings"
    tasks:
      - "AskUserQuestion: Enable spec review before implementation? (default: no)"
      - "AskUserQuestion: Enable code review? If yes, which reviewer? (codex/gemini/none)"
      - "AskUserQuestion: Set custom verify command? (default: none)"
  - id: mode-config
    name: "Mode Configuration"
    description: "Configure mode behavior and paths"
    tasks:
      - "AskUserQuestion: Spec files path? (default: planning/specs)"
      - "AskUserQuestion: Research files path? (default: planning/research)"
      - "AskUserQuestion: Session retention days? (default: 7)"
      - "AskUserQuestion: Install strict mode hooks (PreToolUse gates)? (default: no)"
  - id: write-config
    name: "Write Configuration"
    description: "Write wm.yaml and register hooks in settings.json"
    tasks:
      - "Write .claude/workflows/wm.yaml with collected answers"
      - "Register hooks in .claude/settings.json"
      - "Create .claude/sessions/ directory"
  - id: verify
    name: "Verify Setup"
    description: "Run wm doctor to verify everything is configured correctly"
    tasks:
      - "Run wm doctor --json and display results"
      - "Show summary of installed configuration"
      - "Suggest next steps: wm enter <mode>"
---

# Project Setup Interview

This mode walks through configuring `wm` for your project.

## How It Works

The setup interview has 6 phases:

1. **Bootstrap** — Verify prerequisites and create `.claude/` directory
2. **Project Discovery** — Auto-detect project settings (name, test command, CI)
3. **Review Configuration** — Configure code review and verification settings
4. **Mode Configuration** — Set paths and behavior preferences
5. **Write Configuration** — Write `wm.yaml` and register hooks
6. **Verify** — Run `wm doctor` to confirm everything works

## Quick Setup

If you want to skip the interview and use auto-detected defaults:

```bash
wm setup --yes
```

## What Gets Created

- `.claude/workflows/wm.yaml` — Project configuration
- `.claude/settings.json` — Hook registrations (merged with existing)
- `.claude/sessions/` — Session state directory

## Hooks Installed

**Default (3 hooks):**
- `SessionStart` — Initialize session and inject context
- `UserPromptSubmit` — Detect mode from user message
- `Stop` — Check exit conditions before stopping

**With `--strict` (3 additional hooks):**
- `PreToolUse` — Block writes without active mode
- `PreToolUse:TaskUpdate` — Check task dependencies
- `PreToolUse:TaskUpdate` — Check task evidence
