---
id: onboard
name: "Onboard"
description: "Configure kata for a new project via guided interview"
category: system
phases:
  - id: p0
    name: "Bootstrap"
    description: "Create .claude/ directory and verify prerequisites"
    task_config:
      title: "P0: Bootstrap — verify Node.js and create .claude/"
    tasks:
      - "Verify Node.js >= 18 is installed"
      - "Create .claude/ directory if it does not exist"
      - "Check if wm is already configured (wm.yaml exists)"
  - id: p1
    name: "Setup Style"
    description: "Ask batteries-included vs custom — first question, determines the rest"
    task_config:
      title: "P1: Setup Style — quick (batteries) or custom interview?"
      depends_on: [p0]
    tasks:
      - "AskUserQuestion: Quick setup (batteries-included, all defaults) or custom interview?"
      - "If quick: confirm project name from package.json, then skip to p4"
      - "If custom: continue through p2 and p3"
  - id: p2
    name: "Project Discovery"
    description: "Auto-detect project settings and ask for confirmation (custom path only)"
    task_config:
      title: "P2: Project Discovery — confirm name, test command, CI"
      depends_on: [p1]
    tasks:
      - "AskUserQuestion: Detect project name from package.json — is '{detected_name}' correct?"
      - "AskUserQuestion: Detected test command '{test_command}' — accept or override?"
      - "AskUserQuestion: Detected CI system '{ci_system}' — accept or override?"
  - id: p3
    name: "Custom Configuration"
    description: "Review settings, mode paths, and strict hooks (custom path only)"
    task_config:
      title: "P3: Custom Configuration — review, paths, strict hooks"
      depends_on: [p2]
    tasks:
      - "AskUserQuestion: Enable spec review before implementation? (default: no)"
      - "AskUserQuestion: Enable code review? If yes, which external reviewer? (codex/gemini/none — see ## External Review Setup below)"
      - "AskUserQuestion: Does this project use browser automation for testing? (Playwright/Cypress/Puppeteer/none)"
      - "AskUserQuestion: Behavioral verify command? e.g. 'playwright test', 'cypress run', or custom script. Leave blank for none."
      - "AskUserQuestion: Spec files path? (default: planning/specs)"
      - "AskUserQuestion: Research files path? (default: planning/research)"
      - "AskUserQuestion: Session retention days? (default: 7)"
      - "AskUserQuestion: Install strict mode hooks (PreToolUse gates)? (default: no)"
  - id: p4
    name: "GitHub Setup"
    description: "Verify gh CLI is installed and authenticated"
    task_config:
      title: "P4: GitHub Setup — gh CLI, auth, labels"
      depends_on: [p1]
    tasks:
      - "Check gh CLI is installed (gh --version), guide install if missing"
      - "Check gh auth status, run gh auth login if not authenticated"
      - "Confirm .github/ISSUE_TEMPLATE/ files are in place (from batteries scaffold)"
      - "If batteries was chosen: create all 15 labels from .github/wm-labels.json via gh label create --force (see ## GitHub Setup Phase for exact commands)"
  - id: p5
    name: "Write Configuration"
    description: "Run the appropriate kata setup command based on collected answers, then patch wm.yaml for any custom values"
    task_config:
      title: "P5: Write Configuration — run setup command, patch wm.yaml"
      depends_on: [p4]
    tasks:
      - "Run the appropriate kata setup command (see ## Write Configuration Command below)"
      - "If custom path: patch .claude/workflows/wm.yaml with any values that differ from auto-detected defaults"
      - "Confirm hooks registered in .claude/settings.json"
  - id: p6
    name: "Verify Setup"
    description: "Run kata doctor to verify everything is configured correctly"
    task_config:
      title: "P6: Verify Setup — kata doctor"
      depends_on: [p5]
    tasks:
      - "Run kata doctor --json and display results"
      - "Show summary of installed configuration"
      - "Suggest next steps: kata enter <mode>"
---

# Project Configuration Mode

You are the agent running the kata setup interview. Ask questions, collect answers, then run the appropriate commands. Do not describe what you're about to do — just do it.

## Phase Flow

**Quick path (batteries):** p0 → p1 → p4 → p5 → p6. Skip p2 and p3.
**Custom path:** p0 → p1 → p2 → p3 → p4 → p5 → p6.

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

Agents are invoked with Claude Code's Task tool:
```
Task(subagent_type="impl-agent", prompt="
  Implement phase P2.1 from planning/specs/123-feature.md
  Return: files changed, verification result
")
```
The orchestrator (main session) spawns agents for parallel or delegated work, then collects results via `TaskOutput(task_id=..., block=true)`.

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

If batteries was chosen, create all 15 labels from `.github/wm-labels.json`. Ask first:

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

If yes, read `.github/wm-labels.json` and create each label:

```bash
cat .github/wm-labels.json | node -e "
  const labels = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  labels.forEach(l => process.stdout.write(
    \`gh label create \"\${l.name}\" --color \"\${l.color}\" --description \"\${l.description}\" --force\n\`
  ));
" | bash
```

Or create them one at a time if the pipe fails. The `--force` flag updates existing labels — safe to re-run.

### 4. Issue Templates

Confirm `.github/ISSUE_TEMPLATE/` exists with the 3 templates:
```bash
ls .github/ISSUE_TEMPLATE/
# feature.yml  bug.yml  epic.yml
```

If missing (batteries not yet run):
```bash
kata batteries
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

## Write Configuration Command

After collecting answers through the interview, run **one** of these commands in p5 based on what the user chose:

| Batteries? | Strict hooks? | Command |
|-----------|--------------|---------|
| Yes | Yes | `kata setup --yes --batteries --strict` |
| Yes | No | `kata setup --yes --batteries` |
| No | Yes | `kata setup --yes --strict` |
| No | No | `kata setup --yes` |

`--batteries` scaffolds mode templates, agents, spec templates, and GitHub issue templates.
`--strict` installs the three `PreToolUse` hooks (mode-gate, task-deps, task-evidence).

**Custom path only:** after running the command above, open `.claude/workflows/wm.yaml` and patch any values the user overrode during the interview (spec_path, research_path, test_command, verify_command, reviews, session_retention_days). The `kata setup --yes` command auto-detects sensible defaults; only write fields that differ.

Then run `kata doctor` (p6) to verify everything is correct.

## External Review Setup

When p3 asks "Enable code review? Which reviewer?", first run `kata providers list` to detect which CLIs are installed:

```bash
kata providers list
```

Only offer providers whose CLI is detected. Then ask:

```
AskUserQuestion(questions=[{
  question: "Which agent providers do you want to configure?",
  header: "Providers",
  options: [
    {label: "Claude only", description: "Default — uses Claude Code agent SDK"},
    {label: "Claude + Gemini", description: "Add Google Gemini CLI as reviewer/judge"},
    {label: "Claude + Codex", description: "Add OpenAI Codex CLI as reviewer/judge"},
    {label: "All three", description: "Claude + Gemini + Codex"},
    {label: "Skip provider setup", description: "Configure later with: kata providers setup"}
  ],
  multiSelect: false
}])
```

After selection, run `kata providers setup` to write config to wm.yaml.

### `codex` — OpenAI Codex CLI review
Requires the Codex CLI installed:
```bash
npm install -g @openai/codex
```
Uses `codex exec --sandbox read-only` for code review with full agent capabilities.

### `gemini` — Google Gemini CLI review
Requires the Gemini CLI installed and authenticated:
```bash
npm install -g @google/gemini-cli
gemini auth login
```
Uses `gemini --yolo` for autonomous code review with full agent capabilities.

### `none` — No external review gate
Implementation phases complete without a review step. Recommended for solo projects or when using PR review instead.

## Browser Automation Setup

When p3 asks about browser automation:

### Playwright
```bash
npm install -D @playwright/test
npx playwright install
```
Set verify command in `wm.yaml`:
```yaml
verify_command: "npx playwright test"
```

### Cypress
```bash
npm install -D cypress
```
```yaml
verify_command: "npx cypress run"
```

### Custom script
Any shell command that exits 0 on pass. The command is called by the VERIFY subphase in implementation mode and its output is written to `.claude/verification-evidence/{issue}.json`.

If your project has no browser automation, leave `verify_command` unset — implementation mode will skip the verification gate.

## Hooks Installed

**Default (3 hooks):**
- `SessionStart` — Initialize session and inject context
- `UserPromptSubmit` — Detect mode from user message
- `Stop` — Check exit conditions before stopping

**With `--strict` (3 additional hooks):**
- `PreToolUse` — Block writes without active mode
- `PreToolUse:TaskUpdate` — Check task dependencies
- `PreToolUse:TaskUpdate` — Check task evidence
