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

D015: Standard remote games support 2–4 players. A game may start when all currently seated players are connected and ready and the seat count is between two and four. Before game start, a valid invitation may claim an available player seat up to four total seats. After game start, a valid invitation without an existing seat capability joins as a spectator. Spectators receive only the public projection, cannot ready or submit gameplay commands, do not occupy/recover seats, and do not block saved-game resume. The room transport remains bounded to 12 simultaneous WebSocket connections total. **Superseded for player-count/board-version scope by D016.**

## GAME-MVP 5–6 player board decision

D016: At room creation the host chooses either the standard board for 2–4 players or an expanded board for 5–6 players. The expanded board inserts one five-hex column in the horizontal direction, producing column sizes 3–4–5–5–4–3 (24 hexes total), and contains two deserts. The selected board version is part of authoritative game/recovery state and determines pre-game seat capacity. Existing base-game turn, build, trade, development-card, victory and spectator rules continue unless separately changed.


## Local test-bot decision

D017: Offline/local play may optionally run a deterministic test bot only in a fixed two-player configuration: Player 1 is the human viewer and Player 2 is the bot. The bot exists to exercise gameplay and UI flows without a second person. It must use the same deterministic game-rule reducers as human actions, use no external AI/model/API service, incur no model cost, and must not be connected to private-room multiplayer, WebSocket transport, spectator access or recovery authority. Remote multiplayer continues to have no AI opponents. **Superseded for local bot count by D018.**

## Two-bot local test-mode decision

D018: Offline/local play additionally supports a fixed three-player test mode with Player 1 as the only human viewer and Bot 1 / Bot 2 as deterministic automated players. The existing one-bot two-player mode remains available. All local test bots use the same game-rule reducers and the same local-only constraints from D017; no bot participates in private-room multiplayer, WebSocket transport, spectator access or saved-room recovery.


## Expanded local-bot decision

D019: Offline/local play supports selecting one through five deterministic test bots, with Player 1 as the only human viewer. The selected bot count determines total local player count as Player 1 plus those bots. One through three bots use the standard board (2–4 total players); four or five bots automatically use the expanded 5–6 player board (5–6 total players). The local-only, deterministic, same-reducer and no-external-AI constraints from D017/D018 continue unchanged. This supersedes D018 for local bot count and board-selection behavior.
