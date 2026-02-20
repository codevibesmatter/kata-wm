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

1. **Explore freely** - Read files, search code, ask questions
2. **When done** - Use AskUserQuestion to determine next step:
   - Save findings to research doc
   - Move to planning mode (for features)
   - Move to implementation mode (for tasks)
   - End session (question answered)

## When to Use

- Quick questions about the codebase
- Understanding how something works
- Brainstorming ideas
- Exploratory discussion before deciding on approach

## Exit Pattern

When you've answered the question or explored enough:

```
AskUserQuestion(questions=[{
  question: "What would you like to do next?",
  header: "Next",
  options: [
    {label: "Save findings", description: "Create research doc with key insights"},
    {label: "Plan feature", description: "Switch to planning mode"},
    {label: "Implement task", description: "Switch to implementation mode"},
    {label: "Done", description: "Question answered, end session"}
  ],
  multiSelect: false
}])
```

Then follow the user's choice:
- **Save findings** → Create `planning/research/{date}-{slug}.md`
- **Plan feature** → `mode.sh planning`
- **Implement task** → `mode.sh implementation`
- **Done** → Summarize and end
