---
id: freeform
name: Freeform Mode
description: Quick questions and discussion without heavy structure
mode: freeform

# Zero phases - free exploration
phases: []

# No stop hook enforcement during exploration
stop_hook: false
---

# Freeform Mode

Free exploration and discussion mode. No upfront phases or tasks.

## How It Works

1. **Explore freely** — Read files, search code, ask questions, discuss ideas
2. **When done** — Use AskUserQuestion to determine next step

## When to Use

- Quick questions about the codebase
- Understanding how something works
- Brainstorming ideas before committing to a plan
- Reviewing code or docs informally
- Exploratory discussion before deciding on approach

## Exit Pattern

When you've answered the question or explored enough:

```
AskUserQuestion(questions=[{
  question: "What would you like to do next?",
  header: "Next Step",
  options: [
    {label: "Start planning", description: "Switch to planning mode to write a spec"},
    {label: "Start implementing", description: "Switch to implementation mode"},
    {label: "Save findings", description: "Create a research doc with key insights"},
    {label: "Debug something", description: "Switch to debug mode for systematic investigation"},
    {label: "Done", description: "Question answered — summarize and stop"}
  ],
  multiSelect: false
}])
```

Then follow the user's choice:
- **Start planning** → `kata enter planning`
- **Start implementing** → `kata enter implementation`
- **Save findings** → Write to `planning/research/{YYYY-MM-DD}-{slug}.md`, then commit
- **Debug** → `kata enter debug`
- **Done** → Summarize findings in a few sentences and stop (never run `kata exit`)

## Quick Research Output Format

If saving findings to a research doc:

```markdown
---
date: {YYYY-MM-DD}
topic: {topic}
status: complete
---

# Research: {topic}

## Questions Explored
- {question 1}
- {question 2}

## Key Findings
- {finding with source: file:line or URL}
- {finding}

## Open Questions
- {what's still unclear}

## Next Steps
- {none / planning issue / more research needed}
```

## Agent Spawning (for deeper exploration)

If you need parallel exploration:

```
Task(subagent_type="Explore", prompt="
  Find all places where {topic} is handled.
  Read files in full, document file:line references.
", model="haiku")
```
