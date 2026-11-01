# Development workflow

## Lifecycle

Requirement → Architecture → Task Specification → Implementation → Automated Testing → Architecture Review → Product Owner Acceptance.

The Architect defines technical tasks and acceptance criteria. The Engineer follows applicable approved principles and reports results; the Product Owner decides acceptance.

## Task specification

Each task should include:

- Objective
- Scope
- Relevant design principles
- Acceptance criteria
- Tests
- Out-of-scope items

Before implementation, identify applicable rules and escalate conflicts or consequential ambiguities. Report changed files, tests performed, unresolved issues, and compliance with design principles. Never report unexecuted tests as passed.

## Engineering-task model routing

Apply the approved deterministic routing policy in docs/orchestration/MODEL_ROUTING_POLICY.md: simple uses gpt-5.6-luna with high reasoning; complex uses gpt-6.1-terra with high reasoning; decision does not start a coding agent. Failure never triggers an automatic retry with a different model. Only an explicit Architect decision can reclassify a task.

## Cloud engineering-task execution

The approved cloud issue executor uses GitHub-hosted orchestration, the deterministic model-routing policy and an OpenAI-hosted sandbox. The trusted controller validates artifacts and tests before creating an unmerged PR. Consequential decisions do not start an agent; failure does not cause automatic escalation or a new coding turn.
