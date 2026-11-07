# Decision log

Dates are not supplied in the task specification and are recorded as unknown; they must not be inferred. Technical validation remains pending where stated.

| ID | Decision | Status | Date |
| --- | --- | --- | --- |
| D001 | Three-role development model. | Approved | Unknown |
| D002 | First-version product scope. | Approved | Unknown |
| D003 | GitHub is the source of truth for code and approved documentation. | Recorded as project decision | Unknown |
| D004 | Design principles are mandatory for Codex development. | Recorded as project decision | Unknown |
| D005 | Serverless or low-infrastructure multiplayer is a preference. | Preference; technical validation pending | Unknown |

## Task 00-03 approved decisions

D006: The website may be public; private rooms require a valid invitation or capability, and the website URL alone grants no private-room access.
D007: Evaluate Cloudflare Workers and SQLite-backed Durable Objects for signaling and temporary room coordination; keep actual game traffic peer-to-peer through WebRTC where practical.
D008: The intended game-state architecture is host-authoritative; implementing game state is outside Task 00-03.

## Task ORCH-003 approved decision

D009: The Architect owns engineering-task classification. Simple routes to gpt-5.6-luna with high reasoning; complex routes to gpt-6.1-terra with high reasoning; decision does not start a coding agent. Failures do not trigger automatic model escalation; reclassification requires an explicit Architect decision.

## Task ORCH-004 approved decision

D010: Use a cloud-only GitHub-hosted controller and OpenAI Agents API hosted sandbox for the issue executor. The trusted controller retains credentials and publishes validated changes; the sandbox does not receive those credentials. Disable the legacy self-hosted automatic issue trigger. No automatic merge, model escalation or coding-task rerun is authorized.

## ORCH-004 session spend controls

D011: Agents API coding sessions have Product Owner-approved limits of USD 0.50 for simple tasks and USD 2.00 for complex tasks; decision tasks create no session. A separate project-level monthly hard spend limit is required before activation. Cap exhaustion must not trigger a retry, higher cap or model change.

## GAME-MVP multiplayer transport decision

D012: Replace browser-to-browser WebRTC gameplay transport with authenticated WebSocket relay through Cloudflare Workers and SQLite-backed Durable Objects. Keep the game host-authoritative: the host browser owns gameplay state, entropy, validation and per-player projections; the Durable Object owns room authentication, membership, expiry and bounded message routing. Keep the transport replaceable so a future backend can move away from Cloudflare without rewriting game rules. No TURN, STUN or ICE is required for the standard multiplayer path.


## SEC-001 room-creation authorization decision

D013: Room creation requires one long-lived owner creator capability that is separate from per-room host and guest capabilities. Only a SHA-256 verifier is configured server-side; guest invitations and the public website do not grant room-creation authority. The owner capability is manually rotatable, and rotation affects future room creation without invalidating already-created rooms.
