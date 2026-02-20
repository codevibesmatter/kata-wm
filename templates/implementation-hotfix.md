---
id: implementation-hotfix
name: "Hotfix Implementation"
description: "Emergency fix for production issues"
category: "implementation"
phases:
  - id: p0
    name: "Triage"
    task_config:
      title: "P0: Triage - identify the issue and impact"
      labels: [triage]
  - id: p1
    name: "Fix"
    task_config:
      title: "P1: Fix - implement the minimal fix"
      labels: [fix]
      depends_on: [p0]
  - id: p2
    name: "Verify"
    task_config:
      title: "P2: Verify - test the fix and check for regressions"
      labels: [verify]
      depends_on: [p1]
  - id: p3
    name: "Deploy"
    task_config:
      title: "P3: Deploy - commit, push, and deploy"
      labels: [deploy]
      depends_on: [p2]
---

# Hotfix Implementation

You are in **hotfix** mode. Focus on the minimal change needed to fix the production issue.

## P0: Triage

1. Confirm the issue and its scope
2. Identify the root cause
3. Document the impact

## P1: Fix

1. Implement the minimal fix
2. Do not introduce unrelated changes
3. Run existing tests to confirm fix works

## P2: Verify

1. Test the fix manually
2. Check for regressions
3. Review the diff carefully

## P3: Deploy

1. Commit with a clear message referencing the issue
2. Push to the appropriate branch
3. Monitor after deploy
