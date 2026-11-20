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

## Harbor-order cooperative mode

D020 (2026-11-15): Add Harbor Co-op as a separate two-player ruleset alongside Classic, supporting online two-human, local hotseat and local one-human-plus-one-bot play. Keep existing map, production, building, trading and rendering foundations. Shared timed orders are fulfilled through connected road networks; the team wins or loses together. Preserve private hands, host authority, spectator restrictions, recovery and same-room restart. The cooperative bot is deterministic, local-only and uses no external AI service. Implementation classification: complex. First-play balance defaults and cooperative card/robber adaptations are documented in docs/harbor-coop.md; balance tuning remains open to Product Owner playtesting. No automatic merge into main is authorized.

## Harbor cooperative revision 2 (2026-11-16)

The Product Owner approved paid trade stations at vertices with roads from both players, one card sent per player per own turn per station, asymmetric two-placement openings (Player 1 settlement plus two roads each time; Player 2 city without roads), and a finite twelve-order campaign requiring ten successes. The first order is visible during setup, requires two resource types and allows seven complete team rounds. New orders arrive every three rounds with increasing cargo and decreasing deadlines. Details and explicit numerical tuning choices are in docs/harbor-coop.md; existing version-1 saves retain their original rules until restart. Classic, host authority, separate hands, online/local/Bot support and infrastructure permissions remain unchanged.

### 2026-11-16: Cooperative road ownership

The Product Owner explicitly requires that a partner's buildings and roads cannot support the acting player's road construction. New Harbor v2 games apply this to paid roads and development-card free roads, UI target validation, the host authority and the teammate Bot. A trade station permits bounded gifts only and is not a road anchor. Transport routes to ports remain shared as previously approved. Classic and saved Harbor v1 campaigns retain their existing rules.

### 2026-11-16: Own-road shipping and resource-only seven

The Product Owner superseded shared-road shipping for Harbor v2: both players must use only their own roads to Load. Trade stations remain the sole capped resource-transfer facility and confer no borrowed-road access. The request for a random one-resource grant to both players on seven was clarified twice: there is no discard and no robber movement; the roll immediately enters normal actions after the awards. Knight still uses its existing movement, without a bonus.

Implementation classification: complex. Reuse host-owned entropy, shared deterministic reducers, existing public snapshots and checkpoints; publish only the two new awards, never remaining private hands. Enforce resource conservation with finite-bank shortage handling. Preserve Classic, archived v1 rules and already-recorded in-progress recovery subphases. Unit tests and real-browser checks must exercise ownership rejection, reward visibility, duplicate commands, reconnect and bank shortage before publication. Scope and architecture remain unchanged; no automatic main merge.


## 2026-11-18 optional Classic rules and visual dice pass

D021: The Product Owner approved host-selected optional Catch-up and Harbor Ships rules in Classic only, off by default, public in the lobby and authoritative snapshots and recovery. Catch-up awards actual bank-stock resources after the disadvantaged player's own roll with host-owned randomness (leader >=5, trailing roller <=3; two distinct resources when leader >=6). Harbor Ships cost 3 lumber, 3 brick and 3 ore, require prior port ownership and a legally connected port vertex, yield one VP plus settlement-level production/port trade rights, prevent adjacent construction and cannot anchor/extend a road. Existing Harbor Co-op play is left intact.

D022: The Product Owner approved changing dice to real on-board dice with red recessed 1/4 pips and blue recessed 2/3/5/6 pips, a raised roll surface, collision sounds with local mute control, larger per-resource gain badges, and smaller cities without two elongated windows. Dice animation must immediately dismiss the turn notice and preserve the existing camera and all game rules.

## 2026-11-19: finite ship supply and polished isometric dice

D023: The Product Owner limits optional Classic Harbor Ships to **two per player**. The rule reducer rejects any third ship and the public and private player panels show remaining ship pieces (2, 1, 0); no new hidden inventory, network fields or persistence are needed. Undo restores a piece through the existing game-state snapshot, and restarting a match restores two. Harbor Co-op remains unaffected.

D024: Dice remain real 3D cubes with exactly the host-authoritative top faces, but use an angled three-face presentation: top and two visible lateral faces under the default camera as well as the existing Top view. Dice-specific camera-aware orientation and shallow die tilting change the art only, never the game camera or random outcomes. Clearcoat rounded bevels, warm/cool edge highlights and recessed dot details improve the material depth. Existing reduced-motion preference, resources, 2D fallback and local clatter audio remain.

## 2026-11-19: Harbor ships are independent of roads

D025: The Product Owner explicitly removed the own-road-connection prerequisite for optional Classic Harbor Ships. A player who already owns a port may build each of their two ships on any vacant, legally spaced port vertex, with no connecting road. Keep 3 lumber + 3 brick + 3 ore cost, settlement-distance spacing, two-ship cap, 1 VP, settlement-level production, port-trade benefit, and the rule that ships cannot anchor or extend roads. This supersedes only D021's road requirement; Harbor Co-op construction/Load rules remain unchanged.

## 2026-11-20: Harbor Ship cost reduction

D026: The Product Owner changed the optional Classic Harbor Ships cost from 3 lumber + 3 brick + 3 ore to **2 lumber + 2 brick + 3 ore**. The port-ownership prerequisite, no-road remote placement, building distance, supply cap of two ships per player, 1 VP and other benefits are unchanged. This supersedes the ship-cost terms in D021 and D025 only. The authoritative reducer, Actions affordability, resource display and tests must apply the same cost.
