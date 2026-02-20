---
id: feature-clarification
name: "Feature Clarification"
description: "Deep UI and behavior clarification for existing features"
category: "planning"
phases:
  - id: p0
    name: "Orient"
    task_config:
      title: "P0: Orient - understand the feature area and current state"
      labels: [orient]
  - id: p1
    name: "Clarify"
    task_config:
      title: "P1: Clarify - ask targeted questions and document behavior"
      labels: [clarify]
      depends_on: [p0]
  - id: p2
    name: "Document"
    task_config:
      title: "P2: Document - write up findings and open questions"
      labels: [document]
      depends_on: [p1]
---

# Feature Clarification

You are in **feature-clarification** mode. Your goal is to deeply understand an existing feature's UI behavior and edge cases.

## P0: Orient

Understand the feature area:
- Read existing documentation
- Review the relevant code paths
- Note what is currently implemented vs. what is planned

## P1: Clarify

Ask targeted questions:
- What are the exact UI flows?
- What happens in edge cases?
- What are the acceptance criteria?

Document findings as you go.

## P2: Document

Write up your findings:
- Summary of current behavior
- Open questions
- Recommended next steps
