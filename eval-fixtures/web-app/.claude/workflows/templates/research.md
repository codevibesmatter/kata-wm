---
id: research
name: Research Mode
description: Deep exploration with documented findings and agent-parallel search
mode: research

phases:
  - id: p0
    name: Initial Clarification
    task_config:
      title: "P0: Clarify - understand what to research and why"
      labels: [phase, phase-0, clarify]
    gate: false
    steps:
      - id: clarify-intent
        title: "Clarify research intent"
        instruction: |
          Use AskUserQuestion IMMEDIATELY after mode activation to understand:
          - What topic/area they want to explore
          - Why they need this research (context)
          - What they'll do with the findings

          AskUserQuestion(questions=[
            {
              question: "What would you like to research or explore?",
              header: "Topic",
              options: [
                {label: "Codebase patterns", description: "Find how something is implemented"},
                {label: "External best practices", description: "Research industry approaches"},
                {label: "Both codebase + external", description: "Comprehensive exploration"},
                {label: "Discussion only", description: "Brainstorm or clarify ideas"}
              ],
              multiSelect: false
            },
            {
              question: "What's the context for this research?",
              header: "Context",
              options: [
                {label: "Planning a feature", description: "Research before writing a spec"},
                {label: "Debugging", description: "Understanding existing behavior"},
                {label: "Decision making", description: "Evaluating architectural options"},
                {label: "Learning", description: "General understanding"}
              ],
              multiSelect: false
            }
          ])

          Based on answers, determine which phases to include/skip.
          Then: Mark this task completed via TodoWrite

  - id: p1
    name: Scope Definition
    task_config:
      title: "P1: Scope - define questions and success criteria"
      labels: [phase, phase-1, scope]
      depends_on: [p0]
    gate: false
    steps:
      - id: define-questions
        title: "Define specific research questions"
        instruction: |
          Write down the specific questions this research needs to answer:

          1. Primary question: {what must be answered}
          2. Secondary questions: {nice to have}
          3. Success criteria: {what does a complete answer look like}

          Also: check GitHub issues for related context:
          ```bash
          gh issue list --search "{topic}" --limit 5
          ```

          Then: Mark this task completed via TodoWrite

      - id: set-boundaries
        title: "Set research boundaries"
        instruction: |
          Define explicit boundaries to prevent scope creep:

          **IN scope:**
          - {what to explore}

          **OUT of scope:**
          - {what to skip even if interesting}

          **Time limit:** Set a rough budget (e.g. "30 min codebase, 15 min external").
          Research expands indefinitely without boundaries.

          Then: Mark this task completed via TodoWrite

  - id: p2
    name: Codebase Research
    optional: true
    task_config:
      title: "P2: Codebase - parallel agent exploration (optional)"
      labels: [phase, phase-2, codebase, optional]
      depends_on: [p1]
    gate: false
    steps:
      - id: spawn-explore-parallel
        title: "Spawn parallel Explore agents"
        instruction: |
          Run multiple agents in parallel for fast codebase coverage:

          Task(subagent_type="Explore", prompt="
            Find implementations of {topic} in the codebase.
            Search with Glob and Grep for relevant files.
            Read the most relevant files IN FULL.
            Document: file paths, function names, key patterns.
            Be thorough — don't just skim.
          ", run_in_background=true)

          Task(subagent_type="Explore", prompt="
            Search .claude/rules/ and docs/ for patterns related to {topic}.
            List: constraints, best practices, architectural decisions.
            Read relevant rule files IN FULL.
          ", run_in_background=true)

          # Store task IDs for aggregation step below

      - id: aggregate-codebase-findings
        title: "Aggregate codebase findings"
        instruction: |
          Wait for all agents:
          TaskOutput(task_id=..., block=true)  # each agent

          Compile into structured findings:
          ## Codebase Findings
          - Pattern 1: {description} (source: file:line)
          - Pattern 2: {description} (source: file:line)
          - Existing constraint: {rule or decision}

          Then: Mark this task completed via TodoWrite

  - id: p3
    name: External Research
    optional: true
    task_config:
      title: "P3: External - documentation and best practices (optional)"
      labels: [phase, phase-3, external, optional]
      depends_on: [p2]
    gate: false
    steps:
      - id: web-research
        title: "Web research and documentation review"
        instruction: |
          Search for external context:
          WebSearch(query="{topic} best practices {year}")
          WebSearch(query="{topic} vs {alternative} comparison")

          Fetch relevant documentation:
          WebFetch(url="{doc-url}", prompt="Extract key patterns and recommendations")

          Document findings with sources (URLs).
          Then: Mark this task completed via TodoWrite

  - id: p4
    name: Synthesis
    task_config:
      title: "P4: Synthesize - compile findings, identify recommendations"
      labels: [phase, phase-4, synthesize]
      depends_on: [p3]
    gate: false
    steps:
      - id: synthesize-findings
        title: "Synthesize all findings"
        instruction: |
          Create structured summary:

          ## Research Summary: {topic}

          ### Questions Answered
          - Q: {question}
            A: {answer} (source: file:line or URL)

          ### Key Findings
          - {finding} (source)
          - {finding} (source)

          ### Recommendations
          | Option | Pros | Cons | Fit |
          |--------|------|------|-----|
          | A      | ...  | ...  | High|
          | B      | ...  | ...  | Med |

          ### Open Questions
          - {what's still unclear}

          Then: Mark this task completed via TodoWrite

      - id: create-research-doc
        title: "Write research findings document"
        instruction: |
          Read `research_path` from `.claude/workflows/wm.yaml` (default: `planning/research`).
          Create persistent findings doc at:
          `{research_path}/{YYYY-MM-DD}-{slug}.md`

          Structure:
          ```markdown
          ---
          date: {YYYY-MM-DD}
          topic: {topic}
          status: complete
          github_issue: {N or null}
          ---

          # Research: {topic}

          ## Context
          Why this research was done.

          ## Questions Explored
          - {question 1}

          ## Findings
          ### Codebase
          - {finding} (file:line)

          ### External
          - {finding} (URL)

          ## Recommendations
          {ranked options}

          ## Open Questions
          - {unclear things}

          ## Next Steps
          {none / create spec / more research}
          ```

          Then commit:
          ```bash
          git add {research_path}/
          git commit -m "docs(research): {topic}"
          git push
          ```

          Then: Mark this task completed via TodoWrite

  - id: p5
    name: Present
    task_config:
      title: "P5: Present - share findings, determine next steps"
      labels: [phase, phase-5, present]
      depends_on: [p4]
    gate: false
    steps:
      - id: present-and-decide
        title: "Present findings and decide next step"
        instruction: |
          Present the research summary to the user.

          Then ask:
          AskUserQuestion(questions=[{
            question: "Research complete. What next?",
            header: "Next Step",
            options: [
              {label: "Plan the feature", description: "Switch to planning mode to write a spec"},
              {label: "More research needed", description: "Continue exploring specific questions"},
              {label: "Done", description: "Research complete, no immediate action"}
            ],
            multiSelect: false
          }])

          Follow through on their choice.
          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed

workflow_id_format: "RS-{session_last_4}-{MMDD}"
---

# Research Mode

Deep exploration with parallel agent search and documented findings.

## Phase Flow

```
P0: Clarify (required)     → understand what to research
P1: Scope (required)       → define questions + success criteria
P2: Codebase (optional)    → parallel Explore agents
P3: External (optional)    → web search + documentation
P4: Synthesize (required)  → compile findings + write research doc
P5: Present (required)     → share results + decide next step
```

## Output

- Research doc: `{research_path}/{date}-{slug}.md` (configurable in wm.yaml)
- Structured findings with sources
- Ranked recommendations
- Next steps (none, planning, more research)
