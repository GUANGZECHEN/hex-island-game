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

## Standing publication instruction (Product Owner, 2026-11-15)

- For approved game changes, finish source implementation, validation, and publication through the existing `game/mvp` website deployment without asking for another deployment confirmation.
- Verify the live deployed revision; a local build or downloadable ZIP is not a published update.
- Preserve the existing scope and infrastructure permissions. This does not authorize an automatic merge into `main`, new paid services, or unrelated changes.
- Report failed deployment or incomplete verification plainly; do not claim the website is updated before confirming publication.

## Engineering task routing

The Architect's task classification is authoritative. Follow [the model-routing policy](docs/orchestration/MODEL_ROUTING_POLICY.md): do not self-escalate a model after failure, and do not start implementation for a `decision` task until the consequential decision is resolved and the Architect explicitly classifies the implementation task.
