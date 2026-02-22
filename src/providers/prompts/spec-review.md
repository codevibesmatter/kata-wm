# Spec Review

Review the provided feature specification for completeness, clarity, and feasibility.

## Checklist

### 1. Completeness
- All behaviors have ID, Trigger, Expected, Verify
- No placeholder text (TODO, TBD, unfilled variables)
- Non-goals section present and specific
- Implementation phases cover all behaviors

### 2. Clarity
- Behaviors are unambiguous — a developer could implement from spec alone
- API contracts are concrete (types, endpoints, error codes)
- Phase boundaries are clear (what goes in P1 vs P2)

### 3. Feasibility
- Phases are realistic (not too large for a single session)
- Dependencies between phases make sense
- No circular dependencies or impossible orderings

### 4. Testability
- Each behavior has a concrete verification method
- Test cases are specified per phase
- Acceptance criteria are deterministic, not subjective

### 5. Scope
- Non-goals prevent scope creep
- Open questions are resolved (not left as TODOs)
- Scope matches the issue/initiative size

## Output Format

```
SPEC_SCORE: {number}/100

## Assessment

### Status: PASS | GAPS_FOUND

### Issues

1. **[Category]:** {specific gap}
   - **Where:** {section in spec}
   - **What's missing:** {detail}
   - **Impact:** {what could go wrong without this}

### Strengths
1. {what's done well}
```

Score guide:
- 90-100: Spec is complete and ready for implementation
- 75-89: Minor gaps, implementable with reasonable assumptions
- 60-74: Gaps that need addressing before implementation
- <60: Major gaps, send back for revision
