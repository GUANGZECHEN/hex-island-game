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


## GAME-MVP recovery decision

D013: Persist the host-produced latest authoritative game checkpoint plus the most recent three completed-round checkpoints in the room Durable Object. The Durable Object remains non-authoritative for gameplay: it stores and returns checkpoints but does not evaluate rules or advance state. Original room/seat capabilities are retained locally so the original players can reclaim their seats after page closure. A recovered game remains paused until all original players reconnect and the host explicitly selects a saved checkpoint to resume.


## GAME-MVP QA availability decision

D014: Give rooms a 48-hour lifetime. Keep automatic browser reconnection running for the room lifetime: fast retries first, then 30-second and 60-second background retries. Use a dedicated persistent `hex-island-signaling-qa` Cloudflare Worker and Durable Object namespace for unmerged QA when repository Cloudflare deployment credentials are configured; retain the existing ~50-minute Quick Tunnel path only as a credential-free fallback. The persistent QA Worker must remain separate from the production Worker name and storage.


## GAME-MVP player-count and spectator decision

D015: Standard remote games support 2–4 players. A game may start when all currently seated players are connected and ready and the seat count is between two and four. Before game start, a valid invitation may claim an available player seat up to four total seats. After game start, a valid invitation without an existing seat capability joins as a spectator. Spectators receive only the public projection, cannot ready or submit gameplay commands, do not occupy/recover seats, and do not block saved-game resume. The room transport remains bounded to 12 simultaneous WebSocket connections total.
