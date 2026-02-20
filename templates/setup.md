---
id: setup
name: "Project Setup Interview"
description: "Configure wm for a new project via guided interview"
category: system
phases:
  - id: p0
    name: "Bootstrap"
    description: "Create .claude/ directory and verify prerequisites"
    tasks:
      - "Verify Node.js >= 18 is installed"
      - "Create .claude/ directory if it does not exist"
      - "Check if wm is already configured (wm.yaml exists)"
  - id: p1
    name: "Setup Style"
    description: "Ask batteries-included vs custom — first question, determines the rest"
    tasks:
      - "AskUserQuestion: Quick setup (batteries-included, all defaults) or custom interview?"
      - "If quick: confirm project name from package.json, then skip to p4"
      - "If custom: continue through p2 and p3"
  - id: p2
    name: "Project Discovery"
    description: "Auto-detect project settings and ask for confirmation (custom path only)"
    tasks:
      - "AskUserQuestion: Detect project name from package.json — is '{detected_name}' correct?"
      - "AskUserQuestion: Detected test command '{test_command}' — accept or override?"
      - "AskUserQuestion: Detected CI system '{ci_system}' — accept or override?"
  - id: p3
    name: "Custom Configuration"
    description: "Review settings, mode paths, and strict hooks (custom path only)"
    tasks:
      - "AskUserQuestion: Enable spec review before implementation? (default: no)"
      - "AskUserQuestion: Enable code review? If yes, which reviewer? (codex/gemini/none)"
      - "AskUserQuestion: Set custom verify command? (default: none)"
      - "AskUserQuestion: Spec files path? (default: planning/specs)"
      - "AskUserQuestion: Research files path? (default: planning/research)"
      - "AskUserQuestion: Session retention days? (default: 7)"
      - "AskUserQuestion: Install strict mode hooks (PreToolUse gates)? (default: no)"
  - id: p4
    name: "GitHub Setup"
    description: "Verify gh CLI is installed and authenticated"
    tasks:
      - "Check gh CLI is installed (gh --version), guide install if missing"
      - "Check gh auth status, run gh auth login if not authenticated"
      - "Confirm .github/ISSUE_TEMPLATE/ files are in place (from batteries scaffold)"
      - "If batteries was chosen: offer to create the 5 required labels via gh label create --force (feature, bug, epic, status:todo, status:in-progress)"
  - id: p5
    name: "Write Configuration"
    description: "Write wm.yaml, register hooks, and scaffold batteries if chosen"
    tasks:
      - "Write .claude/workflows/wm.yaml with collected answers"
      - "Register hooks in .claude/settings.json"
      - "Create .claude/sessions/ directory"
      - "If batteries chosen: run 'kata batteries' to scaffold starter content"
  - id: p6
    name: "Verify Setup"
    description: "Run kata doctor to verify everything is configured correctly"
    tasks:
      - "Run kata doctor --json and display results"
      - "Show summary of installed configuration"
      - "Suggest next steps: kata enter <mode>"
---

# Project Setup Interview

This mode walks through configuring `wm` for your project.

## How It Works

The setup interview has 7 phases:

1. **Bootstrap** — Verify prerequisites and create `.claude/` directory
2. **Setup Style** — First question: batteries-included (quick) or custom interview?
3. **Project Discovery** — Auto-detect project settings (custom path only)
4. **Custom Configuration** — Review, paths, strict hooks (custom path only)
5. **GitHub Setup** — Verify `gh` CLI, authenticate, confirm issue templates
6. **Write Configuration** — Write `wm.yaml`, register hooks, scaffold if chosen
7. **Verify** — Run `kata doctor` to confirm everything works

**Quick path (batteries-included):** p0 → p1 (confirm name) → p4 → p5 → p6. Skips p2/p3.
**Custom path:** p0 → p1 → p2 → p3 → p4 → p5 → p6.

## Quick Setup

Skip the interview and use auto-detected defaults:

```bash
wm setup --yes           # Minimal setup
wm setup --batteries     # Setup + full starter content
```

## What Gets Created

**Always:**
- `.claude/workflows/wm.yaml` — Project configuration
- `.claude/settings.json` — Hook registrations (merged with existing)
- `.claude/sessions/` — Session state directory

**With batteries:**
- `.claude/workflows/templates/` — 6 full mode templates with GitHub integration
- `.claude/agents/` — 5 Claude Code sub-agent definitions
- `planning/spec-templates/` — Feature, epic, and bug spec templates

## Batteries-Included Starter Content

When asked "Install batteries-included starter content?", choosing Yes scaffolds:

**Mode templates** (`.claude/workflows/templates/`):
| Template | Description |
|----------|-------------|
| `planning.md` | Research → spec → GitHub issue → review → approve |
| `implementation.md` | Claim branch → implement per spec → PR → close issue |
| `research.md` | Parallel Explore agents → synthesis → research doc |
| `task.md` | Quick plan → implement → commit with issue close |
| `debug.md` | Reproduce → hypotheses → trace → minimal fix |
| `freeform.md` | Free exploration with structured exit patterns |

**Agents** (`.claude/agents/`):
| Agent | Description |
|-------|-------------|
| `spec-writer` | Writes and reviews feature specs |
| `impl-agent` | Implements a specific spec phase |
| `test-agent` | Writes tests for spec behaviors |
| `debug-agent` | Traces bugs to root cause (read-only) |
| `review-agent` | Reviews code and specs for quality |

**Spec templates** (`planning/spec-templates/`):
- `feature.md` — Feature spec with behaviors, phases, acceptance criteria
- `epic.md` — Epic/initiative with features, milestones, success metrics
- `bug.md` — Bug report with reproduction steps and fix tracking

## GitHub Setup Phase

The `github-setup` phase walks through:

### 1. Check `gh` CLI

```bash
gh --version 2>/dev/null || echo "NOT_INSTALLED"
```

If not installed, guide the user:
- macOS: `brew install gh`
- Linux: `sudo apt install gh` or https://cli.github.com
- Windows: `winget install GitHub.cli`

### 2. Check Authentication

```bash
gh auth status 2>/dev/null
```

If not authenticated:
```bash
gh auth login
```
Follow the prompts — choose GitHub.com, HTTPS, browser authentication.

### 3. Create Labels (batteries only)

If batteries was chosen during `mode-config`, offer to create the 5 labels required by the issue templates and workflow commands:

```
AskUserQuestion(questions=[{
  question: "Create GitHub labels for issue tracking? (15 labels: type, priority, status, workflow)",
  header: "Labels",
  options: [
    {label: "Yes — create labels", description: "15 labels covering type, priority, status lifecycle, and workflow state"},
    {label: "No — skip", description: "Create labels manually later"}
  ]
}])
```

If yes:
```bash
# Read .github/wm-labels.json and create each label:
gh label create "{name}" --color "{color}" --description "{description}" --force
```

The `--force` flag updates existing labels, so this is safe to re-run.

### 4. Issue Templates

Confirm `.github/ISSUE_TEMPLATE/` exists with the 3 templates:
```bash
ls .github/ISSUE_TEMPLATE/
# feature.yml  bug.yml  epic.yml
```

If missing (batteries not yet run):
```bash
wm batteries
```

## The Setup Style Question (p1 — first question)

This is the **first question** after bootstrap. Ask it before anything else:

```
AskUserQuestion(questions=[{
  question: "How would you like to set up kata?",
  header: "Setup style",
  options: [
    {
      label: "Quick — batteries-included (recommended)",
      description: "Installs everything with sensible defaults: 6 mode templates, 5 agents, 3 spec templates. Just confirm your project name and go."
    },
    {
      label: "Custom — answer each question",
      description: "Configure spec review, code review, paths, and strict hooks individually. Batteries content optional at the end."
    }
  ],
  multiSelect: false
}])
```

**If Quick:** skip p2 and p3. Just confirm the project name, then proceed to p4 (GitHub Setup). Use all defaults. Set batteries = true.

**If Custom:** continue through p2 (Project Discovery) and p3 (Custom Configuration). At the end of p3, ask the batteries question to decide whether to install starter content.

## Hooks Installed

**Default (3 hooks):**
- `SessionStart` — Initialize session and inject context
- `UserPromptSubmit` — Detect mode from user message
- `Stop` — Check exit conditions before stopping

**With `--strict` (3 additional hooks):**
- `PreToolUse` — Block writes without active mode
- `PreToolUse:TaskUpdate` — Check task dependencies
- `PreToolUse:TaskUpdate` — Check task evidence
