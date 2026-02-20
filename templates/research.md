---
id: research
name: Research Mode
description: Lightweight research and exploration workflow
mode: research

# GH#1083: Simplified - no flavors, phases are optional
# All phases available, skip what's not needed for your research

phases:
  # Phase 0: Initial Clarification (use immediately after mode activation)
  - id: p0
    name: Initial Clarification
    task_config:
      title: "P0: Clarify - understand what user wants to research"
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
                {label: "Discussion only", description: "Brainstorm/clarify ideas"}
              ],
              multiSelect: false
            },
            {
              question: "What's the context for this research?",
              header: "Context",
              options: [
                {label: "Planning a feature", description: "Research before writing spec"},
                {label: "Debugging/investigating", description: "Understanding existing behavior"},
                {label: "Learning/exploration", description: "General understanding"},
                {label: "Decision making", description: "Evaluating options"}
              ],
              multiSelect: false
            }
          ])

          Based on answers, determine which optional phases to include.
          Then: Mark this task completed via TodoWrite

  # Phase 1: Scope Definition
  - id: p1
    name: Scope Definition
    task_config:
      title: "P1: Scope - define questions and boundaries"
      labels: [phase, phase-1, scope]
      depends_on: [p0]
    gate: false
    steps:
      - id: define-questions
        title: "Define research questions"
        instruction: |
          Based on clarification, define specific research questions:

          AskUserQuestion(questions=[
            {question: "What specific question are you trying to answer?", header: "Question", ...},
            {question: "What would a successful answer look like?", header: "Success", ...}
          ])
          Document the research scope.
          Then: Mark this task completed via TodoWrite

      - id: set-boundaries
        title: "Set research boundaries"
        instruction: |
          Define what's IN scope vs OUT of scope.
          Set a time limit if needed (research can expand indefinitely).
          Then: Mark this task completed via TodoWrite

  # Phase 2: Codebase Research (OPTIONAL - skip if not relevant)
  - id: p2
    name: Codebase Research
    optional: true
    task_config:
      title: "P2: Codebase - spawn Explore agents, gather findings (optional)"
      labels: [phase, phase-2, codebase, optional]
      depends_on: [p1]
    gate: false
    steps:
      - id: spawn-explore-similar
        title: "Spawn Explore: similar implementations"
        instruction: |
          Task(subagent_type="Explore", prompt="
            Find implementations related to {topic}.
            Read them IN FULL. Document file:line refs.
          ", run_in_background=true)

      - id: spawn-explore-patterns
        title: "Spawn Explore: patterns and rules"
        instruction: |
          Task(subagent_type="Explore", prompt="
            Search .claude/rules/ for patterns related to {topic}.
            List relevant constraints and best practices.
          ", run_in_background=true)

      - id: spawn-explore-episodic
        title: "Spawn Explore: episodic memory"
        instruction: |
          Task(subagent_type="Explore", prompt="
            Run: .claude/skills/episodic-memory/scripts/em.sh search '{topic}'
            Extract learnings from past sessions.
          ", run_in_background=true)

      - id: aggregate-findings
        title: "Aggregate codebase findings"
        instruction: |
          TaskOutput for each agent (block=true).
          Compile findings into structured summary.
          Then: Mark this task completed via TodoWrite

  # Phase 3: External Research (OPTIONAL - skip if not relevant)
  - id: p3
    name: External Research
    optional: true
    task_config:
      title: "P3: External - competitive analysis, documentation (optional)"
      labels: [phase, phase-3, external, optional]
      depends_on: [p2]
    gate: false
    steps:
      - id: competitive-analysis
        title: "Competitive analysis (if relevant)"
        instruction: |
          WebSearch(query="{topic} best practices")
          Document how other products/projects solve this.
          Skip if not relevant to research scope.
          Then: Mark this task completed via TodoWrite

      - id: documentation-review
        title: "Documentation review"
        instruction: |
          WebFetch relevant documentation URLs.
          Extract key patterns and approaches.
          Then: Mark this task completed via TodoWrite

  # Phase 4: Synthesis
  - id: p4
    name: Synthesis
    task_config:
      title: "P4: Synthesize - compile findings, create research doc"
      labels: [phase, phase-4, synthesize]
      depends_on: [p3]
    gate: false
    steps:
      - id: compile-findings
        title: "Compile all findings"
        instruction: |
          Create structured summary:

          ## Research Summary
          **Question:** [original question]
          **Key Findings:**
          - Finding 1 (source: file:line or URL)
          - Finding 2 (source)
          - Finding 3 (source)

          **Recommendations:**
          - Option A: [approach] - Pros/Cons
          - Option B: [approach] - Pros/Cons

          Then: Mark this task completed via TodoWrite

      - id: create-findings-doc
        title: "Create research findings document"
        instruction: |
          Create persistent research findings doc:

          .claude/workflows/scripts/init-research-findings.sh \
            --title="{research_topic}" \
            --status=complete

          Fill in the findings doc using the Edit tool:
          - Context: Why this research happened
          - Questions explored: The specific questions answered
          - Findings: Key insights with sources
          - Open questions: What's still unclear
          - Next steps: Implementation, more research, or none

          Then: Mark this task completed via TodoWrite

  # Phase 5: Present
  - id: p5
    name: Present Findings
    task_config:
      title: "P5: Present - share findings, determine next steps"
      labels: [phase, phase-5, present]
      depends_on: [p4]
    gate: false
    steps:
      - id: present-summary
        title: "Present findings to user"
        instruction: |
          Present the research summary to the user.
          Ask if they have follow-up questions.
          Document any additional clarifications.
          Then: Mark this task completed via TodoWrite

      - id: determine-next-steps
        title: "Determine next steps"
        instruction: |
          Ask user:
          - Ready to plan implementation? → Switch to planning-feature mode
          - Need more research? → Continue research
          - Research complete? → End session

          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed

workflow_id_format: "RS-{session_last_4}-{MMDD}"
---

# Research Mode

This template defines a lightweight workflow for research and exploration.

## How It Works

Research mode is less structured than feature planning:
- No hard gate phases (soft tracking only)
- Parallel exploration encouraged
- Output is a research findings document
- Skip optional phases (codebase, external) as needed

## Phases

| Phase | Required | Description |
|-------|----------|-------------|
| clarify | Yes | Initial clarification using AskUserQuestion (immediately after mode entry) |
| scope | Yes | Define questions and boundaries based on clarification |
| codebase | Optional | Explore codebase for similar implementations |
| external | Optional | Competitive/documentation research |
| synthesize | Yes | Compile findings, create research doc |
| present | Yes | Present findings and determine next steps |

## When to Use Each Phase

- **clarify**: Always - understand what user wants BEFORE exploring
- **codebase**: Understanding how something works, finding similar implementations
- **external**: Researching best practices, competitive analysis, external docs
- **Skip codebase+external**: Brainstorming ideas, discussing approaches, clarifying requirements

## Output

Research mode produces:
- Research findings doc: `planning/research/{date}-{slug}.md`
- Structured findings with sources
- Next steps (none, planning issue, more research)
