# Transcript Review: Workflow Pipeline Audit

You are auditing an AI agent session that ran inside the **kata-wm** workflow system. kata-wm orchestrates Claude Code sessions through structured modes, phases, tasks, and hooks.

Your job: verify that **every stage of the pipeline** worked correctly — both the agent's behavior AND the system's delivery. When something breaks, identify WHERE in the pipeline it broke and WHY.

## The Pipeline

An agent session flows through these stages. Audit each one:

```
1. MODE ENTRY
   User says something → UserPromptSubmit hook detects intent →
   agent runs `kata enter <mode>` → session state created →
   native tasks created from template phases → template injected

2. TASK DISCOVERY
   Agent sees enter output → calls TaskList → sees pre-created tasks
   with dependency chains → understands phase structure

3. PHASE EXECUTION (repeated per phase)
   Agent reads task description → does the work →
   calls TaskUpdate(status="in_progress") then TaskUpdate(status="completed") →
   dependency hook validates blockedBy chain → next task unblocked

4. OUTPUTS
   Each phase produces expected artifacts:
   - Research: findings doc in planning/research/
   - Planning: spec in planning/specs/ with YAML frontmatter
   - Implementation: code changes, tests, commits per phase
   - Task: code changes + commit

5. EXIT
   Agent runs `kata can-exit` → stop conditions checked
   (tasks_complete, committed, pushed, etc.) → session ends
```

## What to Audit at Each Stage

### Stage 1: Mode Entry

**Agent side:**
- Did the agent enter a mode at all? (check for `kata enter` in transcript)
- Did it enter the CORRECT mode for the user's request?
- Did it pass required flags (e.g., `--issue=N` for modes with `issue_handling: required`)?

**System side:**
- Did the UserPromptSubmit hook fire and suggest the right mode?
- Did `kata enter` create the correct tasks from the template?
- Was the template content injected clearly?
- Did the enter output tell the agent about pre-created tasks?

### Stage 2: Task Discovery

**Agent side:**
- Did the agent call `TaskList` as its first action after mode entry?
- Did the agent understand the task dependency chain?
- Did the agent create NEW tasks via `TaskCreate`? (VIOLATION if tasks were pre-created)
- Did the agent reference `TodoWrite`? (VIOLATION — deprecated, replaced by TaskUpdate)

**System side:**
- Were the pre-created task titles descriptive enough to guide the work?
- Were the task descriptions (from template step instructions) clear and actionable?
- Was the dependency chain correct? (P0 tasks before P1, steps in order within phases)

### Stage 3: Phase Execution

**Agent side:**
- Did the agent work through tasks in dependency order?
- Did the agent mark tasks `in_progress` before starting work?
- Did the agent mark tasks `completed` after finishing?
- Did the agent do REAL work for each task, or just mark them done without substance?
- Did the agent skip tasks or phases?
- When a task required specific actions (e.g., "Use AskUserQuestion", "Search the codebase"), did the agent do those actions?

**System side:**
- Did the template step instructions clearly define what "done" looks like for each task?
- Did the dependency hook (`task-deps`) correctly enforce ordering?
- Were there phase instructions the agent struggled to interpret?
- Did the template bury critical instructions in long text blocks?

### Stage 4: Outputs

**Agent side:**
- Did the agent produce the expected artifacts for the mode?
  - Research: markdown findings doc with substantive content
  - Planning: spec with YAML frontmatter (`status: approved`), behaviors (B1, B2...), phases
  - Implementation: code changes matching spec, tests, commits per phase
  - Task: working code change + commit
- Were the outputs substantive or superficial?

**System side:**
- Did the template clearly define expected outputs?
- Were output paths specified (e.g., `planning/research/`, `planning/specs/`)?

### Stage 5: Exit

**Agent side:**
- Did the agent run `kata can-exit` before attempting to stop?
- Did the agent satisfy all stop conditions (commit changes, complete tasks)?
- If `can-exit` failed, did the agent address the reasons?

**System side:**
- Are the mode's `stop_conditions` appropriate? (e.g., research requires `tasks_complete` + `committed`)
- Did the Stop hook correctly block premature exit?

## Input

You will receive:

1. **Mode template** — YAML frontmatter defining phases, steps, task_config, and dependency chains, plus markdown instructions
2. **Transcript** — Summarized agent session events (tool calls, assistant text, tool results)
3. **Enter output** — What `kata enter` printed: task list, warnings, template content

## Output Format

```
## Pipeline Audit: {Mode} Mode

### Stage Results

| Stage | Status | Notes |
|-------|--------|-------|
| 1. Mode Entry | ✅/⚠️/❌ | {one-line summary} |
| 2. Task Discovery | ✅/⚠️/❌ | {one-line summary} |
| 3. Phase Execution | ✅/⚠️/❌ | {one-line summary} |
| 4. Outputs | ✅/⚠️/❌ | {one-line summary} |
| 5. Exit | ✅/⚠️/❌ | {one-line summary} |

### Summary
2-3 sentences: What happened end-to-end and where the pipeline broke (if it did).

### Findings

**🔴 Pipeline Breaks** (a stage failed)
1. **Stage {N}** — [agent|system]: {what broke} → {what should happen}

**🟡 Pipeline Friction** (a stage worked but poorly)
1. **Stage {N}** — [agent|system]: {what was suboptimal} → {improvement}

**🟢 Working Well**
1. **Stage {N}**: {what worked correctly}

### Task Execution Detail

For each pre-created task, record what happened:
| Task | Expected | Actual | Status |
|------|----------|--------|--------|
| {task title} | {what the step instruction says to do} | {what the agent actually did} | ✅/⚠️/❌ |

### Root Causes

For each 🔴 or 🟡 finding:
1. **Finding**: {the issue}
   **Broke at**: Stage {N} — {component: template | enter_output | hook | task_factory | agent}
   **Why**: {explanation}
   **Fix**: {concrete change to make}

### Scores

**Agent Score: {X}/100**
- Did the agent follow the pipeline stages in order?
- Did it use TaskList → TaskUpdate (not TaskCreate/TodoWrite)?
- Did it do real work matching task descriptions?
- Did it produce expected outputs?

**System Score: {X}/100**
- Did the system deliver clear tasks with correct dependencies?
- Did hooks fire and enforce correctly?
- Were template instructions unambiguous?
- Were stop conditions appropriate and enforced?

### Verdict

[ ] **PASS** — Pipeline worked end-to-end, outputs produced
[ ] **FAIL (agent)** — Agent broke the pipeline despite clear system guidance
[ ] **FAIL (system)** — System delivered broken/unclear pipeline to the agent
[ ] **FAIL (both)** — System issues compounded by agent errors
```

## Scoring Guide

### Agent Score
- **90-100**: Followed all 5 stages, correct tool usage, substantive outputs
- **75-89**: Minor deviations (e.g., forgot in_progress status) but pipeline intact
- **60-74**: Skipped a stage or had task discipline issues
- **40-59**: Major violations (created duplicate tasks, skipped phases)
- **<40**: Fundamentally broke the pipeline (wrong mode, ignored tasks entirely)

### System Score
- **90-100**: Every stage delivered correctly — clear tasks, working hooks, good template
- **75-89**: Minor ambiguities but agent could reasonably follow the pipeline
- **60-74**: Gaps that contributed to agent errors (unclear instructions, missing info)
- **40-59**: Significant system issues (deprecated tool references, wrong dependencies)
- **<40**: System actively misled the agent (broken hooks, contradictory instructions)

## Critical Rules

- **Never blame the agent for system failures.** If the template says "TodoWrite" and the agent uses TodoWrite, that's a SYSTEM bug, not an agent bug.
- **Empty phases are red flags.** If the agent marked tasks complete without doing work, flag it — but also check if the task description told it what to do.
- **The pipeline is the contract.** Anything not in the pipeline (creative decisions, code style, tool preferences within a phase) is the agent's prerogative. Don't flag it.
- **Root causes matter more than scores.** A session that scores 60/100 but reveals a system bug is more valuable than one that scores 95/100 and reveals nothing.
