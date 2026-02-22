---
initiative: template-layer-system
type: project
issue_type: feature
status: approved
priority: medium
github_issue: 12
created: 2026-02-22
updated: 2026-02-23
phases:
  - id: p1
    name: "Resolution infrastructure + modes.yaml 3-tier"
    tasks:
      - "Add getUserConfigDir() to lookup.ts with XDG_CONFIG_HOME support"
      - "Extend ModesYamlPaths to 3-tier (package, user, project)"
      - "Update cache.ts merge logic for 3-tier modes.yaml"
      - "Unit tests for getUserConfigDir, 3-tier modes.yaml merge precedence"
  - id: p2
    name: "Template, spec-template, and batteries"
    tasks:
      - "Update resolveTemplatePath with 3-tier fallback chain"
      - "Add resolveSpecTemplatePath with 3-tier chain"
      - "Add scaffoldUserBatteries() for user-level seeding"
      - "Add kata batteries --user flag"
      - "Unit tests for template fallback chains and user batteries"
  - id: p3
    name: "wm.yaml 3-tier and CLI surface"
    tasks:
      - "Add user-level wm.yaml loading (~/.config/kata/wm.yaml)"
      - "Merge chain: defaults → user wm.yaml → project wm.yaml"
      - "Add kata config --show to display resolved config with provenance"
      - "Update help text and documentation"
      - "Integration tests"
---

# Template Layer System: User/Project/Package

> GitHub Issue: [#12](https://github.com/codevibesmatter/kata-wm/issues/12)

## Overview

kata-wm currently has a 2-layer config/template system: package defaults that get copied to project. There is no user-level layer. Developers who use kata-wm across multiple projects must reconfigure each project independently — custom mode templates, spec templates, modes.yaml overrides, and wm.yaml settings all live per-project with no sharing.

This feature adds a user layer between package and project, creating a 3-tier resolution system.

**Merge order** (lowest to highest priority): package → user → project.
**Lookup order** (first match wins): project → user → package.

## Feature Behaviors

### B1: 3-tier modes.yaml resolution

**Core:**
- **ID:** modes-yaml-3tier
- **Trigger:** Any command that calls `loadModesConfig()` — `kata enter`, `kata prime`, `kata status`, hooks
- **Expected:** Modes config merges: package `modes.yaml` → user `~/.config/kata/modes.yaml` → project `.claude/workflows/modes.yaml`. Each layer's mode keys fully replace the previous layer's matching keys (existing shallow-merge semantics extended to 3 tiers).
- **Verify:** Create user modes.yaml with a custom mode `my-mode`. Run `kata prime` from a project without that mode in project-level config. Verify `my-mode` appears. Then add `my-mode` to project modes.yaml with different config — verify project version wins.

#### API Layer

`getModesYamlPath()` returns `{ packagePath, userPath, projectPath }`. `loadModesConfig()` merges all three.

#### Data Layer

New interface:
```typescript
export interface ModesYamlPaths {
  packagePath: string
  userPath: string | null    // NEW
  projectPath: string | null
}
```

---

### B2: 3-tier template resolution

**Core:**
- **ID:** template-3tier
- **Trigger:** `resolveTemplatePath(templateFilename)` during `kata enter`
- **Expected:** Lookup order (first match wins): project `.claude/workflows/templates/` → user `~/.config/kata/templates/` → package `batteries/templates/`. Package batteries dir becomes a runtime fallback (no longer "seeds only"). This changes the existing contract where project templates were required — update CLAUDE.md and `resolveTemplatePath` JSDoc accordingly. Error message changes from "run kata setup" to listing all locations checked.
- **Verify:** Remove `task.md` from project templates. Place custom `task.md` in user dir. Run `kata enter task` — verify user template is used. Remove user `task.md` too — verify package battery template is used as final fallback.

#### API Layer

`resolveTemplatePath()` gains fallback chain instead of hard-failing when project template is missing.

---

### B3: 3-tier spec template resolution

**Core:**
- **ID:** spec-template-3tier
- **Trigger:** Spec creation during planning mode (when planning template instructs agent to copy from spec template)
- **Expected:** Spec template lookup: project `planning/spec-templates/` → user `~/.config/kata/spec-templates/` → package `batteries/spec-templates/`. New function `resolveSpecTemplatePath(name)` with same fallback semantics. Note: the project-level path is hardcoded to `planning/spec-templates/` (NOT derived from `spec_path` in wm.yaml, which points to where specs are *written*, not where templates live).
- **Verify:** Delete project spec templates. Place custom `feature.md` in user dir. Run planning mode — verify user template is found. Remove user's too — verify package battery version is used.

#### API Layer

New exported function:
```typescript
export function resolveSpecTemplatePath(name: string): string
```

---

### B4: User-level batteries seeding

**Core:**
- **ID:** batteries-user-level
- **Trigger:** `kata batteries --user` CLI command
- **Expected:** Copies batteries content to user config dir (`~/.config/kata/`) instead of project. Creates `~/.config/kata/templates/`, `~/.config/kata/spec-templates/`. Same skip/update semantics as project batteries. Does NOT copy agents or GitHub issue templates (those are project-specific).
- **Verify:** Run `kata batteries --user`. Verify files created in `~/.config/kata/`. Run again without `--update` — verify existing files skipped.

#### API Layer

New `scaffoldUserBatteries(update)` function with user-appropriate path mappings:
- `batteries/templates/` → `~/.config/kata/templates/` (NOT `~/.config/kata/.claude/workflows/templates/`)
- `batteries/spec-templates/` → `~/.config/kata/spec-templates/`
- `batteries/modes.yaml` — NOT copied (user should curate their own modes; `kata batteries --user` only seeds templates)

Note: `scaffoldBatteries` hardcodes project-specific subdirectories (`.claude/workflows/templates/`, `planning/spec-templates/`), so it cannot be reused for user-level seeding. A separate function is needed.

---

### B5: 3-tier wm.yaml resolution

**Core:**
- **ID:** wm-yaml-3tier
- **Trigger:** `loadWmConfig()` — used by spec lookup, `can-exit`, eval assertions
- **Expected:** Config merges: hardcoded defaults → user `~/.config/kata/wm.yaml` → project `.claude/workflows/wm.yaml`. Merge rules:
  - **Scalar fields** (`spec_path`, `research_path`, `session_retention_days`, etc.): later layer wins. `null` counts as "set" and wins.
  - **`reviews` object**: shallow merge (each key individually overridden).
  - **`providers` object**: shallow merge.
  - **`project` object**: project-level wm.yaml ONLY. User-level `project` key is ignored entirely (project identity is per-project, not per-user).
  - **`prime_extensions` array**: later layer replaces (not concatenated).
  - **`mode_config` record**: shallow merge (each mode key individually overridden).
- **Verify:** Set `session_retention_days: 30` in user wm.yaml. Project wm.yaml has no override. `loadWmConfig()` returns 30. Add `session_retention_days: 14` to project — returns 14.

#### Data Layer

No schema changes. Same `WmConfig` type. Just loading from one more source.

---

### B6: Config provenance display

**Core:**
- **ID:** config-provenance
- **Trigger:** `kata config --show`
- **Expected:** Displays the resolved configuration with annotations showing which layer each value came from: `(package)`, `(user)`, `(project)`, `(default)`. Provenance is computed at display time by loading each layer independently and comparing — no changes to `loadModesConfig`/`loadWmConfig` return types. The `config --show` command loads all layers separately, then compares each field to determine where the resolved value came from.
- **Verify:** Set values at different layers. Run `kata config --show`. Verify each value shows correct provenance.

#### UI Layer

```
$ kata config --show
spec_path: planning/specs  (project)
research_path: planning/research  (default)
session_retention_days: 30  (user)
modes: 8 modes (6 package + 1 user + 1 project)
templates: task.md (project), planning.md (user), research.md (package), ...
```

#### API Layer

No new return types on existing config functions. Provenance logic is self-contained in the `config` command handler — it loads package, user, and project configs independently, then walks the resolved config annotating each value's source.

---

### B7: Absent user config directory handling

**Core:**
- **ID:** absent-user-dir
- **Trigger:** Any resolution function when `~/.config/kata/` does not exist
- **Expected:** `getUserConfigDir()` always returns the path (never creates it). Resolution functions (`getModesYamlPath`, `resolveTemplatePath`, `resolveSpecTemplatePath`, `loadWmConfig`) silently skip the user layer when the directory or file doesn't exist — same as current behavior for missing project-level modes.yaml. No warning, no error. `kata batteries --user` is the only command that creates the directory.
- **Verify:** On a system with no `~/.config/kata/`, run `kata enter task`. Verify it works normally using project → package fallback (no user layer). Run `kata batteries --user`. Verify directory is now created.

---

## Non-Goals

- **No remote/team layer** — no shared config fetched from a server or repo
- **No per-mode config merging** — a project mode still fully replaces the same user/package mode (no deep merge within a single mode definition)
- **No migration tool** — no automatic migration of existing project configs to user level; users manually move files
- **No user-level session state** — sessions remain strictly per-project
- **No user-level `project` key** — the entire `project` section (`name`, `build_command`, `test_command`, etc.) in wm.yaml is project-specific and ignored at user level
- **No agents or GitHub templates at user level** — agents and issue templates are project-specific; `kata batteries --user` only seeds mode templates and spec templates

## Open Questions

- [x] User config directory: `~/.config/kata/` (XDG-compatible) ~~vs `~/.kata/` (simpler)~~ — going with `~/.config/kata/` for XDG compliance
- [ ] Should `kata setup` prompt about seeding user-level templates, or is `kata batteries --user` sufficient as an explicit opt-in?

## Implementation Phases

See YAML frontmatter `phases:` above. Each phase should be 1-4 hours of focused work.

### P1: Resolution infrastructure
Core plumbing — path detection, merge logic, cache updates. Everything else builds on this.

### P2: Template and spec-template resolution
Wire the 3-tier fallback into template and spec-template lookup. Update batteries to support user target.

### P3: wm.yaml 3-tier and CLI surface
Extend wm.yaml loading, add `kata config --show`, documentation.

## Verification Strategy

### Test Infrastructure
Existing test infrastructure with Node's built-in test runner. Tests for user-level resolution should set `XDG_CONFIG_HOME` to a temp directory (via `process.env` in test setup) to avoid touching the real user home. The `getUserConfigDir()` function reads env vars, making it testable without filesystem mocking.

### Build Verification
`npm run build && npm test`

## Implementation Hints

### Key Files to Modify

| File | Changes |
|------|---------|
| `src/session/lookup.ts` | Add `getUserConfigDir()`, expand `getModesYamlPath()`, update `resolveTemplatePath()` |
| `src/config/cache.ts` | 3-tier merge in `loadModesConfig()` |
| `src/config/wm-config.ts` | 3-tier merge in `loadWmConfig()` |
| `src/commands/scaffold-batteries.ts` | Support user-level target root |
| `src/commands/batteries.ts` | Add `--user` flag |
| `src/commands/enter/spec.ts` | Add `resolveSpecTemplatePath()` |
| `src/index.ts` | Add `config` command dispatch |

### User Config Directory

```typescript
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getUserConfigDir(): string {
  // Respect XDG_CONFIG_HOME if set, otherwise ~/.config/kata
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(xdgConfig, 'kata')
}
```

### Directory Layout After User Batteries

```
~/.config/kata/
├── modes.yaml              # user-level mode overrides
├── wm.yaml                 # user-level defaults (session_retention_days, etc.)
├── templates/              # user-level mode templates
│   ├── planning.md
│   ├── task.md
│   └── my-custom-mode.md
└── spec-templates/         # user-level spec templates
    ├── feature.md
    └── bug.md
```

### Gotchas
- `getPackageRoot()` uses `import.meta.url` — works differently in bundled vs source mode. User config dir uses `os.homedir()` which is stable.
- Cache key must include all 3 paths now: `${packagePath}:${userPath ?? ''}:${projectPath ?? ''}`
- `resolveTemplatePath` currently throws on miss. New behavior: only throw after all 3 layers checked.
- `scaffoldBatteries` uses `getPackageRoot()` for source — this stays the same regardless of target.

---

<!-- Spec for kata-wm issue #12: Template Layer System -->
