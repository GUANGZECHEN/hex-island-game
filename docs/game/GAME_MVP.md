# Hex Island MVP

The game supports three or four private-room players. The board and its seed are described in [board setup](BOARD_SETUP.md); topology is described in [board geometry](BOARD_GEOMETRY.md). A separate deterministic game state contains seats, inventories, bank, development deck and played cards, pieces, building/road ownership, turn phase, robber, trade offer and award holders. Local hot-seat play uses a pass screen before a different player sees their hand.

The setup reducer validates settlement distance and a connected road in clockwise then reverse order. Normal turns roll two dice, distribute resources (including bank shortages), resolve seven/discards/robber/theft when required, and enter the action phase. Roads, settlements and cities validate geometry, supply and costs. Domestic trades require explicit acceptance; bank trades use 4:1 or an owned 3:1/2:1 port. Development cards implement knight, road building, invention, monopoly and hidden victory points. A player may claim ten points on their turn. Longest route enumerates edge-disjoint trails, including cycles, and stops at an opponent's building; award ties retain an eligible incumbent. Largest army uses played knights and the same incumbent tie rule.

## Gameplay interface

The board remains the primary surface. On desktop, the adjacent panel keeps the turn, connection status, private hand and current actions together; on narrow screens the same panel is a compact bottom control surface. Actions, cards, trade and status/log are grouped into client-side tabs. Board targets also have a keyboard-accessible selector and an explicit cancel action. Players may scroll the board itself sideways on very narrow screens to preserve readable cells. The public player strip shows resource-card count, development-card count and public victory points; a player's own development cards use local icons and newly bought cards are marked until they become playable.

A shared set of local SVG resource icons is used on tiles, the private hand, bank, trade quantities and build costs; each hand and cost icon has an accessible text equivalent. Action icons accompany short labels. Unaffordable build actions are disabled with an explanation. Switching tabs, rendering icons and changing layout are local UI operations and send no gameplay or relay messages.

## Multiplayer

Private rooms use Cloudflare Workers and a SQLite-backed Durable Object. Before creating a room, the host chooses a board map seed or randomizes a visual map preview; that selected seed is used when the multiplayer game starts. Room creation returns high-entropy host and guest capabilities. Each browser authenticates one WebSocket to the room Durable Object; the Durable Object tracks membership, enforces room expiry/capacity and relays bounded text messages only between the host and authenticated guests.

Gameplay remains host-authoritative. The host assigns a distinct random seat capability to each guest and keeps the live authoritative game state and entropy in the host browser. Guests send versioned commands to the host through the Cloudflare WebSocket relay. The host validates sender seat, revision, turn and game rules, then returns per-player projections through the same relay. Other players never receive a guest's resource identities or development cards. For crash/page-close recovery, the host also writes bounded complete checkpoints to the room Durable Object. The Durable Object stores these checkpoint payloads but does not evaluate game rules, choose random outcomes, or advance the game.

This standard multiplayer path does not use WebRTC DataChannels, ICE, STUN or TURN. The networking API remains isolated from game rules so a future WebSocket backend can replace Cloudflare without rewriting the rules engine.

A returning guest can reclaim its seat with its locally stored seat capability while the room remains valid. A valid seat capability may replace a stale still-connected peer record, which prevents races between reconnect and delayed WebSocket leave detection. Transient WebSocket failures use fast exponential retries for the first ten attempts, then continue in the background every 30 seconds and eventually every 60 seconds instead of giving up. After reconnect, guests automatically present their existing seat capability and receive the latest snapshot/revision. The host room capability and guest seat capabilities are also retained in local browser storage so page closure does not by itself lose the rejoin identity.

### Saved-game recovery

After game start and after every accepted authoritative command, the host writes a complete latest checkpoint containing the game ID, revision, full private `GameState`, original seat mapping/capabilities, and QA mode flag. When a checkpoint enters a new normal-play round, the previous round's final latest checkpoint is moved into history. The room stores the current latest checkpoint plus at most three historical round checkpoints; setup checkpoints are not added to round history.

If the host page is closed, guests are disconnected by the room relay as before. The original host can use **Rejoin previous room** from the same browser profile; the host capability reconnects to the existing room and loads the latest checkpoint only to reconstruct the original seat registry. Original guests then use their saved guest/seat capabilities to reclaim the same Player IDs. Gameplay stays paused during this process. When all original seats are connected, the host chooses **Resume latest** or one of the retained round checkpoints. The selected checkpoint recreates the host authority at that revision and broadcasts fresh per-player projections. Selecting an older checkpoint is an explicit rollback and becomes the new latest checkpoint.

Recovery data expires with the room's 48-hour lifetime. Clearing browser storage loses that browser's locally retained rejoin capability. This is recovery for the original host and seats, not host migration to a different owner/device.

## Deployment and verification

The frontend is built with `npm ci && npm run build` and uses the existing GitHub Pages base path. The Worker is built from `signaling/` using the checked-in `wrangler.jsonc`. The Cloudflare Git integration can deploy the default branch to the persistent `hex-island-signaling` Worker. GitHub Pages receives the approved Worker HTTPS origin through `VITE_SIGNALING_URL`.

For unmerged QA, the preferred workflow deploys a separate persistent `hex-island-signaling-qa` Worker with its own Durable Object storage whenever the repository has both Cloudflare Actions credentials configured. The GitHub Pages build is bound to that stable workers.dev origin, so the room backend survives the GitHub Actions job and QA rooms can remain recoverable for their full 48-hour lifetime. A push may redeploy the same QA Worker name without changing its origin. If the Cloudflare credentials are absent, the workflow falls back to the previous local Wrangler + Quick Tunnel path for compatibility; that fallback remains bounded to about 50 minutes. The workflow runs the real relay/checkpoint smoke test and Chromium two-browser reconnect, rejoin and saved-game recovery E2E in either mode. After Product Owner acceptance and merge, the production signaling path remains separate.

Local validation is:
- root: `npm ci && npm run typecheck && npm test && npm run build`
- signaling: `cd signaling && npm ci && npm run typecheck && npm test && npm run build`

## Two-browser QA checklist

The opt-in `?qaPlayers=2` mode tests the real room transport and UI with two people. Standard games still require three or four players.

1. Open the host page with `?qaPlayers=2` and confirm the QA indicator.
2. Choose or randomize the host map seed, create a private room and copy the invitation.
3. Open that invitation in a second independent browser/profile.
4. Confirm both browsers report the Cloudflare room/relay as connected.
5. Mark both players ready and start from the host.
6. Complete both setup rounds.
7. Roll and complete at least two normal turns.
8. Confirm each browser sees only its own private resources and development cards.
9. Reload/disconnect the guest, then use **Rejoin previous room** in the same browser profile.
10. Confirm the same guest seat, board state and revision return, then perform one legal action and verify both browsers update.
11. Close both host and guest pages, reopen the same browser profiles, rejoin the hosted room first and the guest second, then confirm the host sees saved-game choices only after the original seats are restored.
12. Select **Resume latest** and confirm both browsers restore the same saved revision, private views and board seed.

The invitation and seat capability are bearer capabilities. Keep them private and do not log or publish them.


## Board readability polish

The gameplay control surface includes a compact public player strip showing every player, each player's public resource-card count, player color, the local player marker, and a non-color-only current-turn highlight. Resource composition remains private.

Board target modes reuse the deterministic local rules reducers to calculate legal settlement, road, city and robber candidates. These candidates are highlighted directly on the SVG board and target-mode changes remain client-only; they do not generate WebSocket messages.

Resource-specific ports use the same local resource SVG vocabulary as hands and build costs. Each port is connected to its two coastal vertices by visible connector lines; generic ports retain a 3:1 label and resource ports show the resource icon plus 2:1. Full port descriptions remain available to assistive technology.


## Trade and robber presentation

Incoming domestic trade offers are displayed from the recipient's perspective: the proposer is named, resources the recipient would receive are shown separately from resources the recipient would give, and the existing Accept/Reject actions remain authoritative.

The desert uses a local SVG terrain icon. The robber is represented by a white prohibition badge with a red ring and diagonal slash. On numbered tiles the badge is centered directly over the number token, and the occupied tile is visually dimmed while the robber marker remains fully visible.
