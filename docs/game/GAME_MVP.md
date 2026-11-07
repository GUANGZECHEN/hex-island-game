# Hex Island MVP

The game supports three or four private-room players. The board and its seed are described in [board setup](BOARD_SETUP.md); topology is described in [board geometry](BOARD_GEOMETRY.md). A separate deterministic game state contains seats, inventories, bank, development deck and played cards, pieces, building/road ownership, turn phase, robber, trade offer and award holders. Local hot-seat play uses a pass screen before a different player sees their hand.

The setup reducer validates settlement distance and a connected road in clockwise then reverse order. Normal turns roll two dice, distribute resources (including bank shortages), resolve seven/discards/robber/theft when required, and enter the action phase. Roads, settlements and cities validate geometry, supply and costs. Domestic trades require explicit acceptance; bank trades use 4:1 or an owned 3:1/2:1 port. Development cards implement knight, road building, invention, monopoly and hidden victory points. A player may claim ten points on their turn. Longest route enumerates edge-disjoint trails, including cycles, and stops at an opponent's building; award ties retain an eligible incumbent. Largest army uses played knights and the same incumbent tie rule.

## Multiplayer

Private rooms use Cloudflare Workers and a SQLite-backed Durable Object. Room creation returns high-entropy host and guest capabilities. Each browser authenticates one WebSocket to the room Durable Object; the Durable Object tracks membership, enforces room expiry/capacity and relays bounded text messages only between the host and authenticated guests.

Gameplay remains host-authoritative. The host assigns a distinct random seat capability to each guest and keeps the authoritative game state and entropy in the host browser. Guests send versioned commands to the host through the Cloudflare WebSocket relay. The host validates sender seat, revision, turn and game rules, then returns per-player projections through the same relay. Other players never receive a guest's resource identities or development cards. The Durable Object does not evaluate game rules and does not store the authoritative game state.

This standard multiplayer path does not use WebRTC DataChannels, ICE, STUN or TURN. The networking API remains isolated from game rules so a future WebSocket backend can replace Cloudflare without rewriting the rules engine.

A returning guest can reclaim its seat with the session-stored seat capability while the host remains available. A host disconnect ends room gameplay availability; host migration and host-refresh recovery are not implemented.

## Deployment and verification

The frontend is built with `npm ci && npm run build` and uses the existing GitHub Pages base path. The Worker is built from `signaling/` using the checked-in `wrangler.jsonc`. The Cloudflare Git integration can deploy the default branch to the persistent `hex-island-signaling` Worker. GitHub Pages receives the approved Worker HTTPS origin through `VITE_SIGNALING_URL`.

For unmerged QA, the GitHub workflow runs the same Worker/Durable Object code behind an isolated temporary QA endpoint, performs live room/WebSocket checks, builds Pages with that tested endpoint and leaves the production Worker untouched. After Product Owner acceptance and merge, the Cloudflare Git integration deploys the same signaling code from `main`.

Local validation is:
- root: `npm ci && npm run typecheck && npm test && npm run build`
- signaling: `cd signaling && npm ci && npm run typecheck && npm test && npm run build`

## Two-browser QA checklist

The opt-in `?qaPlayers=2` mode tests the real room transport and UI with two people. Standard games still require three or four players.

1. Open the host page with `?qaPlayers=2` and confirm the QA indicator.
2. Create a private room and copy the invitation.
3. Open that invitation in a second independent browser/profile.
4. Confirm both browsers report the Cloudflare room/relay as connected.
5. Mark both players ready and start from the host.
6. Complete both setup rounds.
7. Roll and complete at least two normal turns.
8. Confirm each browser sees only its own private resources and development cards.
9. Reload/disconnect the guest, then use **Rejoin previous room** in the same browser profile.
10. Confirm the same guest seat, board state and revision return, then perform one legal action and verify both browsers update.

The invitation and seat capability are bearer capabilities. Keep them private and do not log or publish them.
