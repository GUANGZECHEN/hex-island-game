# Project instructions

Before every development task, read `design_principles/README.md`, the relevant design principles, and current project instructions. Approved design principles are binding constraints.

## Pre-task checklist

- Read the design principles index, applicable documents, and current project instructions.
- Identify the rules and approved decisions applicable to the task before editing code.
- Check the task against those rules; stop and report conflicts before implementation.
- Identify missing requirements: state minor reversible assumptions explicitly and escalate consequential ambiguities.

## Working rules

- Do not independently modify approved product scope, game rules, or major architecture decisions.
- Keep implementation modular, testable, and maintainable.
- Do not introduce paid services or external infrastructure without Product Owner approval.
- Update relevant documentation whenever approved decisions change.
- For every completed task, report changed files, tests performed, unresolved issues, and compliance with design principles. Never mark unexecuted tests as passed.
- Keep commits focused and avoid unrelated changes.

## Engineering task routing

The Architect's task classification is authoritative. Follow [the model-routing policy](docs/orchestration/MODEL_ROUTING_POLICY.md): do not self-escalate a model after failure, and do not start implementation for a `decision` task until the consequential decision is resolved and the Architect explicitly classifies the implementation task.
