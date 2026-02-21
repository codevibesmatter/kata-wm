# Eval Harness Redesign — Research Findings

## Problem

The current `eval/harness.ts` has several fundamental flaws:

1. **Double context injection**: `appendSystemPrompt` manually injects kata prime output, but `settingSources: ['project']` loads `.claude/settings.json` which defines hooks that ALSO inject context. The SessionStart hook fires `kata hook session-start` which injects the same context. Result: duplicate/conflicting injection.

2. **Preset infrastructure**: Hardcodes `git init`, bare remote creation, and initial commit. Real users don't have this handed to them — they go through onboarding.

3. **Disposable temp dirs**: Copies fixture to `/tmp`, runs agent, deletes everything. Can't iterate, can't inspect, can't rerun.

4. **Wrong comment**: Line 7 says "CLI hooks do NOT fire when using the SDK." This is factually incorrect. `settingSources: ['project']` loads `.claude/settings.json` hooks and they fire naturally.

## Key Discovery: SDK Hook Behavior

From the SDK type definitions (`sdk.d.ts:820-828`):

```
settingSources?: SettingSource[];
- 'user'    → ~/.claude/settings.json
- 'project' → .claude/settings.json
- 'local'   → .claude/settings.local.json
When omitted or empty, no filesystem settings are loaded (SDK isolation mode).
```

The fixture at `eval-fixtures/web-app/.claude/settings.json` defines:
- `SessionStart` → `kata hook session-start` (injects mode context)
- `UserPromptSubmit` → `kata hook user-prompt` (detects mode intent)
- `Stop` → `kata hook stop-conditions` (blocks exit while tasks pending)

These fire automatically when `settingSources: ['project']` is set. No manual injection needed.

## Recommended Design: Two Eval Modes

### Mode A: Fresh Project (Onboarding Eval)

Tests the full new-user experience.

- Copy fixture to a **persistent** location (e.g., `eval-projects/fresh-<timestamp>/`)
- Run agent with `settingSources: ['project']`, `cwd` = project dir
- Hooks fire naturally — NO `appendSystemPrompt`
- Prompt tells agent to onboard: set up git, GitHub, labels, then do work
- Project persists for inspection and re-running

### Mode B: Long-Standing Project (Iterative Eval)

Tests task/planning/implementation against an existing real project.

- Point at an existing project dir (already has git + GitHub)
- Run agent with same SDK options
- Hooks fire naturally
- Agent enters mode, does work, commits
- Project persists — re-run scenarios, inspect results, iterate

## What Changes in Harness

### Remove
- `getKataContext()` function
- `appendSystemPrompt` option
- `GIT_ENV` / `git init` / bare remote setup
- `rmSync` cleanup (projects persist)
- Wrong comment about hooks not firing
- `spawnSync` import (was only for `kata prime`)

### Keep
- `settingSources: ['project']` — how hooks fire
- `permissionMode: 'bypassPermissions'` — full agent autonomy, no approval prompts
- `allowedTools` — tool control
- Transcript writing — debugging
- Checkpoints/assertions — validation
- Token/cost/turn tracking

### Add
- `projectDir` option on `EvalScenario` — point at existing project or specify where to create fresh one
- `fresh: boolean` flag — copy fixture vs use existing
- Persistent project directory (not `/tmp`)

## AskUserQuestion Handling

The SDK provides a `canUseTool` callback that fires when the agent needs user input. Two cases:

1. **Tool approval**: agent wants to use a tool not auto-approved by permission mode
2. **Clarifying questions**: agent calls `AskUserQuestion` tool

For the eval harness, we need to handle `AskUserQuestion` so the agent can ask questions during onboarding or planning. The callback receives the questions array and must return answers.

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "AskUserQuestion") {
    // Present questions to eval runner, collect answers
    // Return { behavior: "allow", updatedInput: { questions, answers } }
  }
  // Auto-approve other tools
  return { behavior: "allow", updatedInput: input };
}
```

### Options for the eval:
- **Interactive mode**: print questions to terminal, wait for human input (for manual iteration)
- **Scripted mode**: provide pre-canned answers for automated eval runs
- **Auto-approve mode**: always pick first option (for smoke testing)

The harness should support all three via a `canUseTool` option on `HarnessOptions`.

## Sources

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- SDK v0.2.50 type definitions (`sdk.d.ts`)
