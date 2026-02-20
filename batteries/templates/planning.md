---
id: planning
name: "Planning Mode"
description: "Feature planning with research, spec writing, GitHub issue, and review"
mode: planning
phases:
  - id: p0
    name: Research
    task_config:
      title: "P0: Research - understand problem space, find similar patterns"
      labels: [phase, phase-0, research]
    steps:
      - id: clarify-scope
        title: "Clarify scope and context"
        instruction: |
          Use AskUserQuestion to clarify what we're planning:

          AskUserQuestion(questions=[
            {
              question: "What are you planning?",
              header: "Feature",
              options: [
                {label: "New feature", description: "Something that doesn't exist yet"},
                {label: "Enhancement", description: "Expanding existing functionality"},
                {label: "Refactor", description: "Code structure change, no behavior change"},
                {label: "Epic", description: "Large initiative spanning multiple features"}
              ],
              multiSelect: false
            },
            {
              question: "Do you have a GitHub issue for this?",
              header: "Issue",
              options: [
                {label: "Yes — link it", description: "I'll provide the issue number"},
                {label: "No — create one", description: "Create a new issue after spec is ready"},
                {label: "No — skip GitHub", description: "Skip GitHub tracking for now"}
              ],
              multiSelect: false
            }
          ])

          Document: type, scope, GitHub issue # if known.
          Then: Mark this task completed via TodoWrite

      - id: codebase-research
        title: "Research existing patterns"
        instruction: |
          Search the codebase for relevant context:

          Task(subagent_type="Explore", prompt="
            Find code patterns related to {feature_topic}.
            Search: Glob, Grep, Read relevant files.
            Document: file paths, function names, patterns to follow.
            Be thorough — read files IN FULL, not just search results.
          ", run_in_background=true)

          Also read any related spec files:
          ```bash
          ls planning/specs/ | grep -i "{keyword}"
          ```

          Wait for agent: TaskOutput(task_id=..., block=true)
          Compile findings into 3-5 bullet points.
          Then: Mark this task completed via TodoWrite

  - id: p1
    name: Spec Writing
    task_config:
      title: "P1: Spec - write feature specification from template"
      labels: [phase, phase-1, spec]
      depends_on: [p0]
    steps:
      - id: create-spec-file
        title: "Create spec file from template"
        instruction: |
          Create a new spec file. Copy from the feature spec template:
          ```bash
          # Check if template exists
          ls planning/specs/_templates/ 2>/dev/null || ls .claude/workflows/spec-templates/ 2>/dev/null
          ```

          Create spec at: `planning/specs/{issue-number}-{slug}.md`

          Use this frontmatter:
          ```yaml
          ---
          initiative: {slug}
          type: project
          issue_type: feature
          status: draft
          priority: medium
          github_issue: {number or null}
          created: {YYYY-MM-DD}
          updated: {YYYY-MM-DD}
          phases: []
          ---
          ```

          Then: Mark this task completed via TodoWrite

      - id: write-behaviors
        title: "Write feature behaviors and acceptance criteria"
        instruction: |
          Write the spec body following this structure:

          ## Overview
          1-3 sentences: what problem this solves, for whom, and why now.

          ## Feature Behaviors

          For each behavior:
          ```
          ### B{N}: {Behavior Name}
          **Core:**
          - **ID:** {kebab-case-id}
          - **Trigger:** {what causes this}
          - **Expected:** {what should happen}
          - **Verify:** {how to confirm it works}

          **UI Layer:** {what the user sees}
          **API Layer:** {endpoint, input, output}
          **Data Layer:** {schema changes, if any}
          ```

          ## Non-Goals
          Explicit list of what this feature does NOT do.

          ## Implementation Phases
          Break into 2-5 phases (p1, p2...) with concrete tasks per phase.
          Phases go in the YAML frontmatter `phases:` array.

          Then: Mark this task completed via TodoWrite

      - id: link-github-issue
        title: "Create or link GitHub issue"
        instruction: |
          **If issue exists:** Update the `github_issue:` frontmatter field.
          Mark it as spec-in-progress:
          ```bash
          gh issue edit {N} --remove-label "status:todo" --add-label "status:in-progress" --add-label "needs-spec"
          ```

          **If creating new issue:**
          ```bash
          gh issue create \
            --title "{feature title}" \
            --body "$(cat planning/specs/{spec-file}.md | head -50)" \
            --label "feature" \
            --label "status:in-progress" \
            --label "needs-spec"
          ```
          Note the issue number. Update spec frontmatter `github_issue:` field.
          Update spec filename to include issue number: `{N}-{slug}.md`

          **If skipping:** Leave `github_issue: null`

          Then: Mark this task completed via TodoWrite

  - id: p2
    name: Review
    task_config:
      title: "P2: Review - check completeness and correctness"
      labels: [phase, phase-2, review]
      depends_on: [p1]
    steps:
      - id: completeness-check
        title: "Check spec completeness"
        instruction: |
          Review spec against this checklist:
          - [ ] All behaviors have ID, Trigger, Expected, Verify
          - [ ] No placeholder text (TODO, TBD, {variable} left unfilled)
          - [ ] File paths in spec actually exist (or will be created)
          - [ ] Implementation phases cover all behaviors
          - [ ] Non-goals section present
          - [ ] GitHub issue linked (or explicitly skipped)

          Fix any gaps found.
          Then: Mark this task completed via TodoWrite

      - id: spawn-review-agent
        title: "Spawn spec review agent"
        instruction: |
          Mark issue as needing review:
          ```bash
          gh issue edit {N} --remove-label "needs-spec" --add-label "needs-review"
          ```

          Spawn a review agent to give a second opinion:

          Task(subagent_type="spec-writer", prompt="
            Review this spec for completeness and correctness:
            Read: planning/specs/{spec-file}.md

            Check:
            1. Are behaviors clear and testable?
            2. Are phases realistic (not too large or small)?
            3. Missing edge cases?
            4. Ambiguous requirements?

            Output: numbered list of issues (or 'LGTM' if clean)
          ", run_in_background=false)

          Address any issues raised.
          Then: Mark this task completed via TodoWrite

  - id: p3
    name: Finalize
    task_config:
      title: "P3: Finalize - approve spec, commit, push"
      labels: [phase, phase-3, finalize]
      depends_on: [p2]
    steps:
      - id: approve-spec
        title: "Mark spec approved and commit"
        instruction: |
          Update spec frontmatter: `status: approved`
          Update `updated:` field to today's date.

          Commit:
          ```bash
          git add planning/specs/{spec-file}.md
          git commit -m "docs(spec): {feature title} — spec approved"
          git push
          ```

          Mark issue as approved and ready for implementation:
          ```bash
          gh issue edit {N} --remove-label "needs-review" --remove-label "status:in-progress" --add-label "approved" --add-label "status:todo"
          ```

      - id: update-issue
        title: "Update GitHub issue with spec link"
        instruction: |
          If GitHub issue exists:
          ```bash
          gh issue comment {N} --body "Spec approved: planning/specs/{spec-file}.md

          Ready for implementation: \`wm enter implementation\`"
          ```

          Then: Mark this task completed via TodoWrite

global_conditions:
  - changes_committed
  - changes_pushed
---

# Planning Mode

You are in **planning** mode. Create a feature spec through research, writing, and review.

## Phase Flow

```
P0: Research
    ├── Clarify scope + GitHub issue
    └── Codebase research (Explore agent)

P1: Spec Writing
    ├── Create spec file from template
    ├── Write behaviors + acceptance criteria
    └── Link GitHub issue

P2: Review
    ├── Completeness checklist
    └── Spec review agent

P3: Finalize
    ├── Mark approved
    ├── Commit + push
    └── Comment on GitHub issue
```

## Stop Conditions

- Spec file exists with `status: approved`
- Changes committed and pushed
- GitHub issue linked or explicitly skipped
