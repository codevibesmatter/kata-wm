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
    description: "Configure mode behavior, paths, and starter content"
    tasks:
      - "AskUserQuestion: Spec files path? (default: planning/specs)"
      - "AskUserQuestion: Research files path? (default: planning/research)"
      - "AskUserQuestion: Session retention days? (default: 7)"
      - "AskUserQuestion: Install strict mode hooks (PreToolUse gates)? (default: no)"
      - "AskUserQuestion: Install batteries-included starter content? (templates, agents, spec templates)"
  - id: github-setup
    name: "GitHub Setup"
    description: "Verify gh CLI is installed and authenticated"
    tasks:
      - "Check gh CLI is installed (gh --version), guide install if missing"
      - "Check gh auth status, run gh auth login if not authenticated"
      - "Confirm .github/ISSUE_TEMPLATE/ files are in place (from batteries scaffold)"
      - "If batteries was chosen: offer to create the 5 required labels via gh label create --force (feature, bug, epic, status:todo, status:in-progress)"
  - id: write-config
    name: "Write Configuration"
    description: "Write wm.yaml, register hooks, and scaffold batteries if chosen"
    tasks:
      - "Write .claude/workflows/wm.yaml with collected answers"
      - "Register hooks in .claude/settings.json"
      - "Create .claude/sessions/ directory"
      - "If batteries chosen: run 'wm batteries' to scaffold starter content"
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

The setup interview has 7 phases:

1. **Bootstrap** — Verify prerequisites and create `.claude/` directory
2. **Project Discovery** — Auto-detect project settings (name, test command, CI)
3. **Review Configuration** — Configure code review and verification settings
4. **Mode Configuration** — Set paths, behavior preferences, and batteries option
5. **GitHub Setup** — Verify `gh` CLI, authenticate, confirm issue templates
6. **Write Configuration** — Write `wm.yaml`, register hooks, scaffold if chosen
7. **Verify** — Run `wm doctor` to confirm everything works

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

## The Batteries Question (mode-config phase)

During the interview, you will be asked:

```
AskUserQuestion(questions=[{
  question: "Install batteries-included starter content?",
  header: "Batteries",
  options: [
    {
      label: "Yes — install everything",
      description: "6 mode templates, 5 agents, 3 spec templates. Best for new projects."
    },
    {
      label: "Yes — templates only",
      description: "Mode templates only, skip agents and spec templates"
    },
    {
      label: "No — minimal setup",
      description: "Just wm.yaml and hooks. Add content manually later with: wm batteries"
    }
  ],
  multiSelect: false
}])
```

If **Yes**: run `wm batteries` (or `wm batteries --templates-only`) after writing config.
If **No**: skip. User can run `wm batteries` at any time later.

## Hooks Installed

**Default (3 hooks):**
- `SessionStart` — Initialize session and inject context
- `UserPromptSubmit` — Detect mode from user message
- `Stop` — Check exit conditions before stopping

**With `--strict` (3 additional hooks):**
- `PreToolUse` — Block writes without active mode
- `PreToolUse:TaskUpdate` — Check task dependencies
- `PreToolUse:TaskUpdate` — Check task evidence
