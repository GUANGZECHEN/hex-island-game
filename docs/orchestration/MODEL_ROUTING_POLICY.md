# Deterministic engineering-task model routing

This is the Product Owner-approved policy for engineering tasks. The Architect owns the classification and may explicitly reclassify a task through a deliberate new decision. The Engineer implements the assigned task, must not self-upgrade its model tier or reinterpret a `decision` as permission to implement, and stops on consequential unresolved decisions. This document and the policy module define routing; they do not launch agents or automatically integrate with existing runners.

| Architect class | Coding agent | Reasoning | Automatic retry or escalation |
| --- | --- | --- | --- |
| `simple` | `gpt-5.6-luna` | `high` | None |
| `complex` | `gpt-6.1-terra` | `high` | None |
| `decision` | **Do not start** | Not applicable | None |

A failed task is reported as failed or blocked. Failure never automatically retries or switches the model. Only an explicit Architect decision can reclassify a task. The mapping is centralized in `src/orchestration/model-routing.ts`; future orchestration should consume the abstract class rather than embedding model names. Model availability has not been verified by this policy.

## Architect classification order

1. An unapproved consequential product, architecture, security, cost, data-policy, deployment-platform, licensing, repository-visibility, or game-rule decision → `decision`. Obtain Product Owner approval before implementation and then explicitly classify the resulting implementation task.
2. Any complex trigger below → `complex`.
3. All six simple conditions below → `simple`; otherwise → `complex`. When uncertain, choose `complex`.

Simple requires **all** of: fully approved and explicit behavior; a local change in one existing feature area; no new external service, network protocol, persistence, authorization or process boundary; no concurrency, distributed consistency, reconnection, ordering or cross-client synchronization problem; a low blast radius and easy rollback; and explicit testable acceptance. Examples include copy or accessible-label changes, localized CSS, a known localized bug, a pure deterministic helper or its tests, and an already-specified rule change within an established subsystem.

Any one of these is complex: crossing multiple core modules; networking or multi-client state (including WebRTC, signaling, lifecycle or retries); a security boundary (including credentials, authorization and untrusted input); concurrency, ordering or timing; a core data model, protocol, API or state-machine change; initial scaffolding of a major subsystem; an unknown root cause; or a task requiring several major architectural concepts together. A new external service or dependency with meaningful architectural, security, licensing or cost implications first requires the appropriate approval; absence of approval is `decision`.

Decision examples include unapproved accounts, paid infrastructure or TURN, room authorization semantics, host-authority or topology changes, user data collection/persistence, product databases, deployment platform, game rules, licensing, repository visibility and destructive history changes. The Product Owner resolves such consequential choices; the Architect then records a new explicit implementation classification. Decompose large features into complex scaffolding, simple local deterministic work, and complex integration where useful.

## Metadata and deterministic policy functions

The Architect records exactly one case-sensitive metadata value on the issue or orchestration input:

```yaml
complexity: simple # alternatively complex or decision
```

`routeTask({ complexity: 'simple' })` consumes that explicit class and returns the corresponding immutable route; `complex`, `decision`, and malformed/missing metadata are handled deterministically. Unknown or absent classification defaults to `complex`. Route results include `startAgent`, `model`, `reasoning` and `automaticRetry`; decision returns `startAgent: false` and no model. `startAgent` is a class-level eligibility gate, not an instruction to schedule a run. The function has no failure input and never performs execution or retry. A caller must separately enforce lifecycle state and must not schedule an automatic retry after failure; a failure or status field cannot select another tier.

For an Architect's optional explicit checklist, `classifyChecklist` accepts `unapprovedDecision` and two boolean maps. `simpleConditions` must contain every one of `fullySpecified`, `localChange`, `noNewBoundary`, `noConsistencyProblem`, `lowBlastRadius`, and `explicitAcceptance` set to true. `complexTriggers` must contain all of `multipleCoreModules`, `networkedState`, `securityBoundary`, `concurrencyOrTiming`, `coreDataOrProtocol`, `newSubsystem`, `unknownRootCause`, and `largeContext` set to false. Any true unapproved decision takes precedence; otherwise any true complex trigger is complex. Missing, unknown or non-boolean evidence defaults to complex. This checklist is an aid for explicit human assessments, not an LLM or a replacement for Architect authority. A future orchestrator must not use it to silently reclassify an assigned issue.

The existing ORCH-002 Windows runner predates this policy and is **not wired to `routeTask`**. Its current behavior must not be represented as enforcing this decision gate or model mapping. Integrating or enforcing the policy in an executor is outside ORCH-003 and requires a separately approved task. Until then, do not rely on ORCH-002 to block `decision` issues or choose a model.
