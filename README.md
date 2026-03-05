# @codevibesmatter/kata

Structured workflow CLI for [Claude Code](https://claude.ai/claude-code). Wraps sessions with modes, phase task enforcement, and a stop hook that blocks exit until phases are done.

## Table of Contents

1. [What kata does](#what-kata-does)
2. [Install](#install)
3. [Quick start](#quick-start)
4. [Built-in modes](#built-in-modes)
5. [How it works](#how-it-works)
   - [Mode lifecycle](#mode-lifecycle)
   - [Context injection](#context-injection)
   - [Planning → Implementation pipeline](#planning--implementation-pipeline)
   - [Hook chain](#hook-chain)
6. [Stop conditions](#stop-conditions)
7. [Command reference](#command-reference)
   - [Core commands](#core-commands)
   - [Other commands](#other-commands)
8. [Hooks reference](#hooks-reference)
9. [Configuration (kata.yaml)](#configuration-katayaml)
10. [Custom modes](#custom-modes)
11. [Batteries system](#batteries-system)
12. [Architecture](#architecture)
13. [Comparison to similar tools](#comparison-to-similar-tools)
14. [License](#license)

---

## What kata does

Claude sessions are unstructured by default. The agent can answer, stop, and close the session at any time — even mid-task, mid-phase, or before committing work.

**kata enforces that sessions complete.** When you enter a mode, kata creates native phase tasks with dependency chains. A stop hook intercepts every attempt to end the session and blocks exit until all phase tasks are done, work is committed, and any additional stop conditions are met.

Three concrete benefits:

- **Phase tasks auto-created** — `kata enter planning` creates the research → spec → review → approved task chain. Claude sees these via `TaskList` and follows them in order.
- **Stop hook blocks early exit** — Claude cannot end the session until all tasks are complete. No skipping the verify phase. No stopping before committing.
- **Session state survives context compaction** — mode, phase, and workflow ID are persisted to disk. Long sessions don't lose their place when the context window rolls over.

---

## Install

```bash
npm install --save-dev @codevibesmatter/kata
```

Or globally:

```bash
npm install -g @codevibesmatter/kata
```

---

## Quick start

**1. Install kata**

```bash
npm install --save-dev @codevibesmatter/kata
```

**2. Set up kata in your project**

Tell Claude:

> Set up kata for this project

Claude runs `kata setup`, registers the stop hook and session hooks in `.claude/settings.json`, and configures `.kata/kata.yaml` for your project. Alternatively, run `kata enter onboard` yourself — this starts the agent-guided onboarding walkthrough.

**3. Enter a mode**

For planning work linked to a GitHub issue:

```bash
kata enter planning --issue=42
```

For a small self-contained task (no issue required):

```bash
kata enter task
```

Phase tasks appear immediately in Claude's task list with dependency chains already set up.

**4. Work through the phases**

Claude follows the task dependency chain. Each phase must complete before the next unlocks. The stop hook silently blocks any attempt to end the session early.

**5. Check exit readiness and exit**

```bash
kata can-exit
# All stop conditions met — ready to exit

kata exit
```

If `kata can-exit` reports unmet conditions (pending tasks, uncommitted changes, tests failing), address them and check again.

---

## Built-in modes

| Mode | Name | Description | Issue required? | Stop conditions |
|------|------|-------------|-----------------|-----------------|
| `research` | Research | Explore and synthesize findings | No | tasks_complete, committed, pushed |
| `planning` | Planning | Research, spec, review, approved | **Yes** | tasks_complete, committed, pushed |
| `implementation` | Implementation | Execute approved specs | **Yes** | tasks_complete, committed, pushed, tests_pass, feature_tests_added |
| `task` | Task | Combined planning + implementation for small tasks | No | tasks_complete, committed |
| `freeform` | Freeform | Quick questions and discussion (no phases) | No | *(none — can always exit)* |
| `verify` | Verify | Execute Verification Plan steps | No | tasks_complete, committed, pushed |
| `debug` | Debug | Systematic hypothesis-driven debugging | No | tasks_complete, committed, pushed |
| `onboard` | Onboard | Configure kata for a new project | No | *(none — can always exit)* |

**Mode aliases:**

- `task` → also: `chore`, `small`
- `debug` → also: `investigate`
- `freeform` → also: `question`, `ask`, `help`, `qa`

`--issue=N` is required for `planning` and `implementation`. It is optional for all other modes.

---

## How it works

### Mode lifecycle

_(content coming in subsequent phases)_

### Context injection

_(content coming in subsequent phases)_

### Planning → Implementation pipeline

_(content coming in subsequent phases)_

### Hook chain

_(content coming in subsequent phases)_

---

## Stop conditions

_(content coming in subsequent phases)_

---

## Command reference

### Core commands

_(content coming in subsequent phases)_

### Other commands

_(content coming in subsequent phases)_

---

## Hooks reference

_(content coming in subsequent phases)_

---

## Configuration (kata.yaml)

_(content coming in subsequent phases)_

---

## Custom modes

_(content coming in subsequent phases)_

---

## Batteries system

_(content coming in subsequent phases)_

---

## Architecture

_(content coming in subsequent phases)_

---

## Comparison to similar tools

The Claude Code ecosystem has several workflow and memory tools. Here's how `kata` fits in.

### Beads (`@beads/bd`)
**[github.com/steveyegge/beads](https://github.com/steveyegge/beads)**

The most influential tool in this space. A git-backed task tracker with a dependency graph — JSONL files in `.beads/`, hash-based IDs to prevent merge conflicts, `bd ready` to surface only unblocked work. Solves "agent amnesia": agents lose all context of prior work between sessions. Anthropic's native `TaskCreate`/`TaskUpdate` system was directly inspired by beads.

**vs `kata`:** Complementary, not competitive. Beads is project-level memory across sessions (days/weeks); `kata` is session-level enforcement within a single session. They stack well — beads tracks what needs doing across the project, `kata` enforces how a single session executes.

---

### RIPER Workflow
**[github.com/tony/claude-code-riper-5](https://github.com/tony/claude-code-riper-5)**

Five-phase structured development: Research → Innovate → Plan → Execute → Review. Enforces phases through **capability restrictions** — in Research mode Claude has read-only access so it can't prematurely write code.

**vs `kata`:** Closest conceptual match. Both enforce named phases in sequence. Key difference: RIPER gates at the *capability* level (what Claude can do in each phase); `kata` gates at the *exit* level (Claude can do anything, but can't stop until phases are done).

---

### Claude Task Master
**[github.com/eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master)**

Parses PRDs into structured tasks using AI via MCP. Handles full task lifecycle with subtask expansion and status tracking.

**vs `kata`:** Task Master is about *creating* a backlog from requirements; `kata` is about *enforcing* that the current session's tasks complete. Different problem.

---

### Summary

| Tool | Core problem | Enforcement | Scope |
|------|-------------|-------------|-------|
| [beads](https://github.com/steveyegge/beads) | Agent amnesia / task tracking | None — agent decides | Project (weeks) |
| [RIPER](https://github.com/tony/claude-code-riper-5) | Phase discipline | Capability gating per phase | Session |
| [Task Master](https://github.com/eyaltoledano/claude-task-master) | PRD → structured backlog | None | Project |
| **kata** | **Session phase enforcement** | **Stop hook blocks exit** | **Session** |

`kata`'s unique position: the only tool focused on *enforcing that sessions complete correctly* via the Stop hook, rather than helping plan or remember work.

---

## License

MIT
