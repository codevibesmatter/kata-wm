---
id: debug
name: Debug Mode
description: Systematic hypothesis-driven debugging with time-boxing and escalation
mode: debug
aliases: [investigate]

phases:
  # Phase 0: Reproduce & Understand System
  - id: p0
    name: Reproduce & System Map
    task_config:
      title: "P0: Reproduce - capture evidence, map affected system"
      labels: [phase, phase-0, reproduce]
    steps:
      - id: reproduce-bug
        title: "Reproduce the bug with evidence"
        instruction: |
          **BEFORE reading any code, reproduce and capture:**

          1. **Exact reproduction steps** (environment, user, actions)
          2. **Screenshot/video** of the failure
          3. **Console errors** if any
          4. **Network errors** if any

          **Check logs if available:**
          - Review application logs for errors
          - Check request traces if available

          **Document:** Write reproduction steps in issue comment.

      - id: map-system
        title: "Map the affected system BEFORE diving into code"
        instruction: |
          **STOP. Do NOT read code yet.**

          Draw the system map for this bug:

          1. **Which systems are involved?**
             - Data layer (entities, schemas)
             - API layer (endpoints, services)
             - Frontend layer (components, state)
             - Infrastructure (workers, queues)

          2. **What's the data flow?**
             ```
             [User Action] → [Frontend Component] → [API Endpoint] → [Service] → [Database]
             ```
             Fill in specifics for THIS bug.

          3. **Where could failure occur?**
             - Data layer (wrong data, missing data)
             - API layer (wrong response, error)
             - Frontend layer (wrong rendering, state issue)

          **Document your system map** before proceeding.

      - id: classify-bug-type
        title: "Classify: Data bug vs Code bug vs Config bug"
        instruction: |
          **Most bugs fall into 3 categories:**

          | Type | Symptom | Investigation |
          |------|---------|---------------|
          | **Data Bug** | Correct code, wrong data | Query database, check data values |
          | **Code Bug** | Wrong logic, missing case | Read code, trace execution |
          | **Config Bug** | Wrong setup, missing config | Check schemas, settings, env |

          **For this bug, what's your initial classification?**

          Then: Mark this task completed via TodoWrite

  # Phase 1: Hypothesize (Time-boxed)
  - id: p1
    name: Form Hypotheses
    task_config:
      title: "P1: Hypothesize - form 2-3 theories, rank by likelihood"
      labels: [phase, phase-1, hypothesize]
      depends_on: [p0]
    steps:
      - id: form-hypotheses
        title: "Form 2-3 competing hypotheses"
        instruction: |
          **Based on system map, form 2-3 hypotheses:**

          | Hypothesis | Likelihood | Test to Prove/Disprove |
          |------------|------------|------------------------|
          | H1: [theory] | High/Med/Low | [quick test] |
          | H2: [theory] | High/Med/Low | [quick test] |
          | H3: [theory] | High/Med/Low | [quick test] |

          **Rules:**
          - At least one hypothesis must be "data bug"
          - At least one hypothesis must be "config/schema bug"
          - Each hypothesis must have a QUICK test (< 5 min)

          **Bad hypotheses:**
          - "Something is wrong in the code" (too vague)
          - "The API is broken" (where specifically?)

          **Good hypotheses:**
          - "Status field value 'not_started' doesn't exist in status set" (testable)
          - "API returns 404 because route not registered" (testable)
          - "Frontend uses wrong field name" (testable)

      - id: rank-and-test-order
        title: "Rank hypotheses, plan test order"
        instruction: |
          **Test highest-likelihood hypothesis FIRST.**

          For each hypothesis, plan:
          1. **Quick test** (under 5 minutes)
          2. **Expected result if true**
          3. **Expected result if false**

          **CRITICAL: Do NOT start reading code until you've tested at least one hypothesis.**

          Then: Mark this task completed via TodoWrite

  # Phase 2: Test Hypotheses (Time-boxed)
  - id: p2
    name: Test Hypotheses
    task_config:
      title: "P2: Test - prove/disprove each hypothesis quickly"
      labels: [phase, phase-2, test]
      depends_on: [p1]
    steps:
      - id: spawn-investigation-agents
        title: "Spawn Explore agents for deep investigation (MANDATORY)"
        instruction: |
          **DO NOT directly read files to investigate. Spawn Explore agents.**

          For CODE investigation (tracing execution flow):
          ```
          Task(subagent_type="Explore", prompt="
            Investigate {component} for issue #{num}.
            - Read relevant files IN FULL (not snippets)
            - Trace execution flow: entry point → failure
            - Document file:line refs for key code paths
            - Look for error handling gaps, edge cases
          ", run_in_background=true)
          ```

          For CONTEXT gathering (past sessions, patterns):
          ```
          Task(subagent_type="Explore", prompt="
            Search for context on {feature/error}.
            - Check .claude/rules/*.md for relevant patterns
            - Check recent git commits touching affected files
          ", run_in_background=true)
          ```

          **Orchestrator does:** Quick data queries, simple checks
          **Explore agents do:** Deep file reading, code tracing

      - id: test-h1
        title: "Test Hypothesis 1 (max 10 min)"
        instruction: |
          **TIME BOX: 10 minutes max**

          Test your first hypothesis using available tools:

          For DATA bugs:
          - Query the database to check data values

          For CONFIG bugs:
          - Check configuration files and schemas

          For API bugs:
          - Test the endpoint with appropriate credentials

          For CODE bugs:
          - Wait for Explore agent results (spawned above), then analyze findings.

          **Record result:**
          - H1 PROVEN: [evidence]
          - H1 DISPROVEN: [evidence] → move to H2

      - id: test-h2
        title: "Test Hypothesis 2 (max 10 min)"
        instruction: |
          **TIME BOX: 10 minutes max**

          If H1 disproven, test H2.

          **Record result:**
          - H2 PROVEN: [evidence]
          - H2 DISPROVEN: [evidence] → move to H3

      - id: escalation-checkpoint
        title: "ESCALATION CHECKPOINT"
        instruction: |
          **CHECK: Have you spent > 30 minutes without proving a hypothesis?**

          If YES:
          1. **STOP investigating**
          2. **Document what you've tried** and results
          3. **Ask user for help:**

          AskUserQuestion(questions=[{
            question: "I've tested N hypotheses without finding root cause. What else should I check?",
            header: "Debug Help",
            options: [
              {label: "Check [specific area]", description: "..."},
              {label: "Ask teammate", description: "Someone else may know this system"},
              {label: "Pair debug", description: "Let's debug together"}
            ]
          }])

          **Do NOT continue reading random code files hoping to find the answer.**

          Then: Mark this task completed via TodoWrite

  # Phase 3: Root Cause Confirmation
  - id: p3
    name: Confirm Root Cause
    task_config:
      title: "P3: Confirm - verify root cause, document clearly"
      labels: [phase, phase-3, confirm]
      depends_on: [p2]
    steps:
      - id: document-root-cause
        title: "Document confirmed root cause"
        instruction: |
          **Root cause must be SPECIFIC and VERIFIABLE:**

          BAD: "The status isn't rendering correctly"
          GOOD: "Status value 'not_started' doesn't exist in the status set"

          BAD: "The API is returning wrong data"
          GOOD: "normalizer.ts:45 maps 'contract_value' but field is named 'budget'"

          **Document:**
          ```markdown
          ## Root Cause

          **What's wrong:** [specific issue]
          **Where:** [file:line or table.column]
          **Evidence:** [database query, API response, screenshot]
          **Category:** Data / Code / Config bug
          ```

      - id: decide-fix-approach
        title: "Decide: Fix data, fix code, or fix config?"
        instruction: |
          **Based on root cause category:**

          | Category | Fix Approach |
          |----------|--------------|
          | Data Bug | Fix data source (normalizer, seed, migration) |
          | Code Bug | Fix logic (with TDD) |
          | Config Bug | Fix schema, settings, option sets |

          Then: Mark this task completed via TodoWrite

  # Phase 4: Apply Fix (TDD)
  - id: p4
    name: Apply Fix
    task_config:
      title: "P4: Fix - TDD, minimal change, verify"
      labels: [phase, phase-4, fix]
      depends_on: [p3]
    steps:
      - id: write-failing-test
        title: "Write failing test (TDD Step 1: RED)"
        instruction: |
          Write a test that:
          - Reproduces the exact bug scenario
          - Fails with the current broken behavior
          - Will pass when bug is fixed

          Run your test command - it MUST FAIL.
          (If it passes, test doesn't catch the bug)

      - id: apply-minimal-fix
        title: "Apply minimal fix (TDD Step 2: GREEN)"
        instruction: |
          Make the MINIMAL change to fix the bug:
          - Don't refactor
          - Don't add features
          - Don't "improve" nearby code

          Run your test command - it MUST PASS now.

      - id: verify-fix
        title: "Verify fix doesn't break other things"
        instruction: |
          Run the full test suite, typecheck, and lint:
          - Tests must pass
          - Type check must pass
          - Lint must pass

          Then: Mark this task completed via TodoWrite

      - id: commit-and-push
        title: "Commit with root cause explanation"
        instruction: |
          ```bash
          git add -A
          git commit -m "fix: [brief description]

          Root cause: [what was actually wrong]
          Fix: [what you changed]"
          git push
          ```

          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed

workflow_id_format: "DBG-{session_last_4}-{MMDD}"
---

# Debug Mode

Systematic hypothesis-driven debugging with time-boxing and escalation.

## The Anti-Pattern (What Failed)

```
Bug reported → Read code → Read more code → Read even more code → Try random fix → Hours wasted
```

## The Correct Pattern

```
Bug → Reproduce → Map System → Hypothesize → Test → Confirm → Fix
        |            |            |           |
     Evidence    Data Flow    2-3 Theories  Quick Tests (< 10 min each)
```

## Phase 0: Reproduce & Map System

**BEFORE reading ANY code:**

1. **Reproduce with evidence** - Screenshot, console errors, network errors
2. **Map the system** - Which components? What data flow?
3. **Classify bug type** - Data vs Code vs Config

**Why this matters:** Most "bugs" are actually data issues or config mismatches. Understanding the system FIRST prevents code diving.

## Phase 1: Form Hypotheses

**Require 2-3 competing hypotheses:**

| Hypothesis | Type | Quick Test |
|------------|------|------------|
| Value missing from status set | Config | Query status table |
| Normalizer maps wrong field | Data | Check normalizer field mapping |
| Field type renderer has bug | Code | Add console.log to renderCell |

**Rules:**
- At least one "data bug" hypothesis
- At least one "config bug" hypothesis
- Each hypothesis has a < 5 min test

## Phase 2: Test Hypotheses (Time-Boxed)

**10 minutes max per hypothesis.**

Test highest-likelihood first. Use database queries, API calls, and Explore agents.

**ESCALATION CHECKPOINT:**

If > 30 minutes without proven hypothesis -> STOP -> Ask user for help.

**Do NOT continue reading random files hoping to stumble on the answer.**

## Phase 3: Confirm Root Cause

Root cause must be **SPECIFIC and VERIFIABLE**:

BAD: "Something's wrong with the status display"
GOOD: "Status value 'not_started' doesn't exist in the status set"

## Phase 4: Apply Fix (TDD)

1. Write failing test
2. Apply minimal fix (at root cause, not symptom)
3. Verify no regressions
4. Commit with root cause explanation

## Red Flags (Stop and Reassess)

- Reading > 5 files without a clear hypothesis
- Investigation > 30 minutes without testing a hypothesis
- Tempted to "just fix" something without understanding root cause
- Adding special cases instead of fixing at root cause

## Data vs Code vs Config Decision Tree

```
Is the correct value in the database?
|-- NO -> Data Bug (fix normalizer, seed, or source)
`-- YES -> Is the value in the API response?
          |-- NO -> API Bug (fix service/router)
          `-- YES -> Is the value rendered correctly?
                    |-- NO -> Frontend Bug (fix component)
                    `-- YES -> Not a bug (expected behavior)
```
