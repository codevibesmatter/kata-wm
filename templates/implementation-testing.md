---
id: implementation-testing
name: "Testing Implementation"
description: "Comprehensive test suite implementation"
category: "implementation"
phases:
  - id: p0
    name: "Plan"
    task_config:
      title: "P0: Plan - identify what needs testing and set up test infrastructure"
      labels: [plan]
  - id: p1
    name: "Unit Tests"
    task_config:
      title: "P1: Unit Tests - write unit tests for core logic"
      labels: [unit-tests]
      depends_on: [p0]
  - id: p2
    name: "Integration Tests"
    task_config:
      title: "P2: Integration Tests - write integration tests for key flows"
      labels: [integration-tests]
      depends_on: [p1]
  - id: p3
    name: "Verify"
    task_config:
      title: "P3: Verify - run all tests and confirm coverage"
      labels: [verify]
      depends_on: [p2]
---

# Testing Implementation

You are in **implementation-testing** mode. Your goal is to write comprehensive tests.

## P0: Plan

1. Review the feature/code being tested
2. Identify test cases (happy path, edge cases, error cases)
3. Set up test infrastructure if needed

## P1: Unit Tests

Write unit tests for:
- Core business logic functions
- Data transformations
- Error handling

## P2: Integration Tests

Write integration tests for:
- Key user flows end-to-end
- API endpoints
- Cross-component interactions

## P3: Verify

1. Run the full test suite
2. Check coverage is acceptable
3. Fix any failing tests
4. Commit the test files
