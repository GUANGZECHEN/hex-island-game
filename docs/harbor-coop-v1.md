# Harbor Co-op: first playable ruleset

Bank amendment approved 2026-11-27: the unlimited supply rule in [the current rules](game/GAME_MVP.md#unlimited-bank-resources) supersedes any finite-stock limits below, including for recovered archived matches. All other version-specific mechanics and recorded awards remain as described.

Product Owner approval: 2026-11-15. Implementation: complex. Scope: online two-person team; local two-person hotseat (also usable by one person managing both seats); local Player 1 + one deterministic teammate Bot. Classic remains the default and keeps its rules. No remote bots or new paid service.

## Objective and first-play balance defaults

Supply 6 ships before 3 leave unfilled. There are 2 active orders. Each ship allows 9 full team rounds, counting its arrival round. A round contains one turn per partner, independent of who started. Orders begin after snake setup; setup has no deadline. Loaded cargo can be supplied across turns by either eligible player. Completed and expired cargo returns to the bank. These values are initial tuning choices, not a claim of balanced difficulty.

Both players start with one lumber, brick, wool and grain, removed from the bank. Normal second-settlement production is retained. Each player retains their own hand, building and piece supplies. The standard 19-tile map is used. The existing six-player Classic mode is unaffected.

## Transport and cooperation

Ports are labeled P1–P9 both on the board and on order cards. A player can load their own cards at a port when a continuous network of either player's built roads connects any of their settlements/cities to either coastal vertex of that port. A settlement directly at that port also connects. New roads and settlements may extend the team network, subject to existing distance/piece/cost rules. Cities upgrade only the acting player's settlement.

A partial shipment must be positive, available in the submitting player's own hand, and not exceed the order's remaining needs. During the active player's action phase they may use Load buttons to contribute. No one spends their teammate's cards. Cargo in the shared order is public, while remaining hands stay private. Every Load is host-validated and advances the authoritative revision.

Connected partners may send cards for free or exchange a normal negotiated offer. Without a road connection, gifts and player trades are rejected. Bank/port trade discounts retain the original ownership rules. Cargo shipments and gifts are not undoable; deterministic safe construction/bank Undo remains available only as the latest accepted safe action.

## Cooperative adaptations

The team objective replaces individual 10-point wins. Road/army bonuses do not decide the match. A seven retains exact discards and robber movement, but no teammate theft. Knight moves the robber without stealing. Monopoly becomes a bank requisition of up to two cards of the chosen resource. The five victory-point cards are replaced by Year of Plenty; other development-card timing and limits are retained. These adaptations apply only to Harbor Co-op.

All ships fulfilled produces team victory. The third missed ship produces team defeat. No individual winner is fabricated. Current players remain in the room and can restart. No lighthouse/second victory condition is implemented in this first release.

## UI and supported modes

Create a local or online room, then select Harbor Co-op from Game mode. Local mode locks two seats; choose None for hotseat or 1 bot for a teammate. Online mode is selected by the host and broadcast read-only to guests. Mode changes reset readiness. Switching an already larger lobby to co-op is rejected until surplus players switch to spectators; nobody is silently removed. New arrivals after two seats are occupied may observe.

The order panel is integrated below public player information. It displays loaded/required resources, time remaining, and the number of missing road edges. Private resource/Action controls remain beside the board. Mobile uses the existing compact stacked board layout. Direct board picking, orange target feedback, manual camera preservation and 2D fallback remain intact.

## Determinism, recovery and privacy

Order generation is deterministic from board seed, public order sequence and current geography; it does not consume dice/development-card entropy. Early orders prefer nearby reachable/coast-accessible destinations. Only current orders and public cooperative progress are projected. Source of truth is the host; clients never advance deadlines themselves. All state is included in existing host-only checkpoints. Reconnect, full-page recovery, restart and spectators retain mode/privacy boundaries. Old Classic saves with no mode remain valid.

The local Bot uses the same reducers and only its own hand plus public board/orders. It completes setup, moves the robber away from team production where possible, supplies reachable orders, extends routes, develops production and makes bank trades. There is no external model or API. It is a first-play teammate policy, not a guarantee of optimal play or victory.

## Validation contract

Tests cover mode restrictions, Classic regression, resources in bank/hands/cargo, partial deliveries, expiry, team outcomes, turn ownership, duplicate/stale commands, gift routes, card adaptations, Bot legality/private-hand independence, mode switching, saved checkpoints and restart. Browser coverage includes hotseat, Bot setup, 3D/2D board controls, desktop/mobile, real Load actions and team outcomes. Deployed tests additionally verify online host/guest/spectator setup, guest reconnect, full-page host recovery and room restart. Test fixtures are local-only and excluded from production bundles. Publication must be confirmed separately from local build success.
