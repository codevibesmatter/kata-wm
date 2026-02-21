---
id: eval
name: "Eval Mode"
description: "Run agentic eval scenarios against kata-wm"
mode: eval
workflow_prefix: "EV"

phases:
  - id: onboard
    name: "Onboard Scenario"
    task_config:
      title: "Run onboard scenario — fresh TanStack Start project"
      labels: [eval, scenario, onboard]
    steps:
      - id: run
        title: "Run onboard eval"
        instruction: |
          Run the onboard scenario against a fresh TanStack Start fixture:
          ```bash
          npx tsx eval/run.ts --scenario=onboard --verbose
          ```

          This copies `eval-fixtures/tanstack-start/` to `eval-projects/onboard-<ts>/`
          and prompts the inner agent to set up kata.

          **If the agent asks a question (PAUSED):**
          Resume with the answer a real user would give:
          ```bash
          npx tsx eval/run.ts --scenario=onboard --project="<project_dir>" --resume=<session_id> --answer="<choice>"
          ```

          **When complete:** Note pass/fail, token usage, and any observations.

  - id: task-mode
    name: "Task Mode Scenario"
    task_config:
      title: "Run task-mode scenario — add /health route"
      labels: [eval, scenario, task-mode]
      depends_on: [onboard]
    steps:
      - id: run
        title: "Run task-mode eval"
        instruction: |
          Run against the pre-configured web-app fixture:
          ```bash
          npx tsx eval/run.ts --scenario=task-mode --verbose
          ```

          Or against the onboard project from the previous scenario (long-standing):
          ```bash
          npx tsx eval/run.ts --scenario=task-mode --project="<onboard_project_dir>" --verbose
          ```

          **If PAUSED:** Resume with appropriate answer.
          **When complete:** Note pass/fail, token usage, observations.

  - id: planning-mode
    name: "Planning Mode Scenario"
    task_config:
      title: "Run planning-mode scenario — write a spec"
      labels: [eval, scenario, planning-mode]
      depends_on: [onboard]
    steps:
      - id: run
        title: "Run planning-mode eval"
        instruction: |
          Run against the pre-configured web-app fixture:
          ```bash
          npx tsx eval/run.ts --scenario=planning-mode --verbose
          ```

          Or against a long-standing project:
          ```bash
          npx tsx eval/run.ts --scenario=planning-mode --project="<project_dir>" --verbose
          ```

          **If PAUSED:** Resume with appropriate answer.
          **When complete:** Note pass/fail, token usage, observations.

  - id: report
    name: "Report"
    task_config:
      title: "Summarize eval results"
      labels: [eval, report]
      depends_on: [onboard, task-mode, planning-mode]
    steps:
      - id: summarize
        title: "Write eval summary"
        instruction: |
          Summarize all scenario results:
          - Pass/fail for each scenario
          - Total token usage and cost
          - Observations: what worked, what broke, what needs fixing
          - Action items if any scenarios failed

stop_hook: false
---

# Eval Mode

Drive inner Claude agents through kata scenarios and verify the results.

## How It Works

You (the outer agent) act as the human user. You:

1. **Run each scenario** — tasks are created per scenario, follow them in order
2. **Handle questions** — if the inner agent asks a question (AskUserQuestion), the harness pauses. Resume with `--resume=<session_id> --answer="<choice>"`
3. **Check results** — the harness runs assertions automatically
4. **Report** — summarize pass/fail, token usage, observations

## Running Evals

### Run a single scenario
```bash
npx tsx eval/run.ts --scenario=onboard --verbose
```

### Run against an existing project (long-standing)
```bash
npx tsx eval/run.ts --scenario=task-mode --project=/path/to/project --verbose
```

### Resume a paused session
```bash
npx tsx eval/run.ts --scenario=onboard --project=/path/to/project --resume=<session_id> --answer="Quick setup"
```

### List available scenarios
```bash
npx tsx eval/run.ts --list
```

## Eval Output

- **stdout** — pass/fail, token usage, cost
- **`eval-transcripts/`** — full JSONL transcripts
- **`eval-projects/`** — persistent project dirs for inspection

Both dirs are gitignored.

## Fixture Projects

| Fixture | Path | Description |
|---------|------|-------------|
| `tanstack-start` | `eval-fixtures/tanstack-start/` | Fresh TanStack Start app, no kata config |
| `web-app` | `eval-fixtures/web-app/` | Pre-configured with kata hooks, wm.yaml, templates |

## Key Principle

**You are the user.** When the inner agent asks a question, decide the answer a real user would give. When it makes mistakes, note them. The eval tests the full kata experience, not just code correctness.
