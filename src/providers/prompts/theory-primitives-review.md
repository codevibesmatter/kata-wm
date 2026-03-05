# Theory & Primitives Review

Review the provided feature spec for alignment with platform theory and correct use of platform primitives.

## Context

Baseplane has two layers of platform doctrine that specs must respect:

**Theory** (invariants that survive stack rewrites):
- `domains.md` — module boundaries, capability ownership, org scoping of all entities
- `data.md` — entity definitions, schemas, archetypes, field types, validation
- `dynamics.md` — lifecycle states, transitions, phase rules, temporal patterns
- `experience.md` — UI layout principles, navigation patterns, view shell constraints
- `governance.md` — permission models, access rules, approval chains, audit
- `boundaries.md` — integration patterns, sync models, external API conventions

**Platform Primitives** (use these instead of rolling your own):
1. **DataForge** — entity definitions, schemas, archetypes, validation pipelines
   - USE instead of: custom DB tables, manual CRUD routes, ad-hoc validation
2. **Relationships** — entity connections, foreign keys, reference integrity
   - USE instead of: junction tables, manual join queries, hardcoded parent-child
3. **Workflows** — multi-step processes, state machines, approval chains
   - USE instead of: hardcoded status enums, manual state transitions, if/else chains
4. **Templates** — reusable configurations, defaults, presets
   - USE instead of: hardcoded default values, copy-paste config objects
5. **CommandBus** — frontend operation dispatch, optimistic updates
   - USE instead of: scattered API calls, manual loading/error state management
6. **EventBus** — real-time sync, cache invalidation, cross-module notifications
   - USE instead of: polling, manual refetch, prop drilling for updates

## What to Check

### 1. Theory Alignment

For each behavior and implementation decision in the spec, flag if it:

- **Contradicts theory** — spec assumes something that conflicts with a known theory invariant
  (e.g. spec says entities can exist without org context, but domains.md requires org scoping)
- **Introduces new theory-level concept** — spec defines a new invariant/domain rule not in any theory doc
  (flag for doc update, not a blocker)
- **Misidentifies module ownership** — feature puts logic in the wrong worker/domain
- **Violates lifecycle rules** — state transitions don't follow dynamics.md patterns

### 2. Primitives Compliance

For each data storage, process, or UI operation in the spec, flag:

- 🔴 **Primitive bypass** — spec proposes a custom solution where a platform primitive exists
  (e.g. spec creates a new status enum instead of using Workflows)
- 🟡 **Primitive opportunity** — spec could use a primitive but doesn't mention it
  (not a bypass, but worth flagging for the implementer)
- ✅ **Correct primitive usage** — spec explicitly references and uses the right primitive

### 3. Primitives Design Section

Check if the spec has a `## Primitives Design` section:
- If missing: flag as 🔴 (required for all features touching data or process)
- If present: verify it maps each feature concern to the correct primitive with rationale

## Output Format

```
PRIMITIVES_SCORE: {number}/100

## Assessment

### Status: PASS | NEEDS_REVISION

### Theory Alignment

| Finding | Type | Theory Area | Impact |
|---------|------|-------------|--------|
| {description} | Contradicts / New concept / Misowned / Lifecycle violation | {theory doc} | {blocker/flag-for-update} |

(Write "No issues found" if clean.)

### Primitives Compliance

**🔴 Bypasses (must fix):**
1. **{spec section}:** {what the spec does} → should use {Primitive}
   - Why: {brief explanation}

**🟡 Opportunities (consider):**
1. **{spec section}:** {what the spec does} → could use {Primitive}

**✅ Correct usage:**
- {Primitive}: used correctly in {spec section}

### Primitives Design Section
- Present: yes / no
- Quality: complete / partial / missing

### Issues

1. **[Category]:** {specific issue}
   - **Where:** {section in spec}
   - **Fix:** {what to change}
```

Score guide:
- 90-100: No primitive bypasses, theory-aligned, Primitives Design section complete
- 75-89: Minor opportunities or partial Primitives Design section
- 60-74: One or more 🔴 bypasses or theory contradictions
- <60: Multiple bypasses or fundamental theory misalignment
