# Code Review

Review the provided code diff for quality, correctness, and maintainability.

## Checklist

### 1. Correctness
- Logic errors or off-by-one mistakes
- Null/undefined handling
- Edge cases not covered
- Race conditions or async issues

### 2. Security
- Input validation and sanitization
- Injection vulnerabilities (SQL, XSS, command)
- Secrets or credentials in code
- Insecure dependencies

### 3. Performance
- Unnecessary allocations or copies
- N+1 queries or unbounded loops
- Missing pagination or limits
- Expensive operations in hot paths

### 4. Code Quality
- Naming clarity
- Function/method size (>50 lines is a flag)
- Dead code or unused imports
- Consistent patterns with the rest of the codebase

### 5. Tests
- Are new behaviors tested?
- Are edge cases covered?
- Do tests actually assert meaningful outcomes?

## Output Format

```
REVIEW_SCORE: {number}/100

## Issues Found

### 🔴 Critical (must fix)
1. {file:line} — {issue description}

### 🟡 Suggestion (should consider)
1. {file:line} — {suggestion}

### 🟢 Good
1. {what's done well}
```

Score guide:
- 90-100: Clean, no issues
- 75-89: Minor suggestions only
- 60-74: Some issues that should be addressed
- <60: Significant problems, should not merge as-is
