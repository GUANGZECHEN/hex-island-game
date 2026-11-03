# Hex Island MVP

The game supports three or four private-room players. The board and its seed are described in [board setup](BOARD_SETUP.md); topology is described in [board geometry](BOARD_GEOMETRY.md). A separate deterministic game state contains seats, inventories, bank, development deck and played cards, pieces, building/road ownership, turn phase, robber, trade offer and award holders. Local hot-seat play uses a pass screen before a different player sees their hand.

The setup reducer validates settlement distance and a connected road in clockwise then reverse order. Normal turns roll two dice, distribute resources (including bank shortages), resolve seven/discards/robber/theft when required, and enter the action phase. Roads, settlements and cities validate geometry, supply and costs. Domestic trades require explicit acceptance; bank trades use 4:1 or an owned 3:1/2:1 port. Development cards implement knight, road building, invention, monopoly and hidden victory points. A player may claim ten points on their turn. Longest route enumerates edge-disjoint trails, including cycles, and stops at an opponent's building; award ties retain an eligible incumbent. Largest army uses played knights and the same incumbent tie rule.

## Multiplayer

The signaling service authenticates existing invitation capabilities and negotiates a WebRTC data channel. The host assigns a distinct random seat capability over that channel; a returning guest presents it to reclaim the seat while the host remains available. The browser keeps the invitation and seat capability in session storage; avoid sharing a browser profile or these values. A host disconnect ends availability; host migration and host-refresh recovery are not implemented.

Game messages have protocol version, game ID, revision, command ID, sender and typed command. The host binds the sender to the authenticated peer seat, rejects malformed, oversized, duplicate, stale, out-of-turn and illegal commands, and owns gameplay entropy. The public board seed does not determine multiplayer deck or dice randomness. The host sends each peer a public snapshot and only that peer's resource and development cards; deck order and random state are never projected. Trade offer details are visible only to participants. The host sees the authoritative state. Browser/network failures and disconnections may still interrupt a friend game; no TURN service is provided.

## Deployment and verification

The frontend is built with `npm ci && npm run build` and uses the existing GitHub Pages base path. Set the GitHub Actions `SIGNALING_URL` variable to the approved HTTPS signaling endpoint. The existing Pages workflow deploys `dist`; signaling remains the existing Cloudflare Worker and Durable Object. Local signaling checks are `cd signaling && npm ci && npm run typecheck && npm test && npm run build` (the build is a dry run). No additional service or account system is required by this implementation.

Before accepting a release, test on distinct networks and browsers: create a room, share the invitation privately, join two or three guests, ready and start, complete setup and several turns, check private hands, trades, robber, cards and win, disconnect/rejoin a guest, and confirm stale actions are rejected. Check the 320px and 375px layouts, keyboard access, pass screen and manual diagnostic link. The development environment could not establish a live DataChannel because its browsers gathered no ICE candidates; offer/answer and local room creation were verified, but actual cross-network WebRTC remains a manual acceptance item.

## One-time signaling deployment setup

The repository cannot authorize a Cloudflare account or create its API token for you. An account owner must complete those steps once. If this is the account's first Worker, Cloudflare may also require accepting its terms and registering a `workers.dev` subdomain before a non-interactive deployment can succeed. SQLite Durable Objects are available within Cloudflare's free-tier limits; usage beyond those limits is subject to Cloudflare's current terms.

1. In Cloudflare, create an account-scoped API token using the official **Edit Cloudflare Workers** template, limited to the intended account. Copy its account ID. Add both as repository Actions secrets at **Settings → Secrets and variables → Actions → Secrets**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Never put the token in a variable, issue, or repository file.
2. With `SIGNALING_URL` still unset, run **Actions → Deploy PoC to GitHub Pages → Run workflow**, selecting `game/mvp`. This existing workflow can be dispatched before this PR is merged; its manual QA run calls the checked-in signaling workflow, checks the credentials, installs the locked dependencies, typechecks/tests, deploys the Worker, and supplies the reported origin directly to that Pages build. A missing secret fails the signaling job clearly and prevents that Pages build. A normal `main` push does not deploy signaling.
3. Open the signaling job's summary and copy the reported `SIGNALING_URL` origin. At **Settings → Secrets and variables → Actions → Variables**, create repository variable `SIGNALING_URL` with that exact HTTPS origin. This one manual variable update is needed because the default `GITHUB_TOKEN` cannot grant itself repository-administration write permission; no personal access token is required. Future Pages builds use the variable. If the first Pages deployment did not finish, rerun **Deploy PoC to GitHub Pages** for `game/mvp` after setting it.

The dedicated **Deploy signaling Worker** workflow can also be dispatched after this workflow file exists on the default branch. It produces the Worker origin as a job output and summary. If an account has no registered `workers.dev` subdomain or the token lacks permission, it fails; resolve the specific account setup or authorization and rerun it. No owner-specific Worker hostname, paid service, or manual Durable Object configuration is embedded in the repository.

## Two-browser QA checklist

This opt-in mode is only for testing the real networking and UI with two people. Standard games still require three or four players; there is no AI or simulated opponent.

1. Open the host page with `?qaPlayers=2` appended to its URL and confirm the **2-player QA mode** indicator is visible.
2. Create a private room and copy its invitation.
3. Open that invitation in a second independent browser or browser profile and confirm the QA indicator there.
4. Mark both players ready and start the game from the host browser.
5. Complete both setup rounds, placing each settlement and its adjacent road.
6. Roll and complete at least two turns.
7. Confirm each browser sees only its own private resources and development cards.
8. Disconnect or reload the guest, then use **Rejoin previous room** in that same browser profile.
9. Confirm the same guest seat, board state and current revision are restored.
10. Perform an action after reconnecting and confirm both browsers receive the update.

The invitation and seat capability are stored in the guest tab's session storage; rejoining after a reload uses that same tab/profile while the host remains connected. Do not share the invitation or stored seat capability beyond intended participants.
