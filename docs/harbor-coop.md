# Harbor Co-op v2: trade stations and a 12-order campaign

Product Owner approval: 2026-11-16. Task classification: complex, directly approved gameplay implementation. Supported: two humans online, local hotseat/solo control of both seats, or one human plus a local teammate Bot. Classic is unchanged. New games use harbor version 2; existing version-1 saves retain their recorded rules (docs/harbor-coop-v1.md) until restarted.

## Explicit user rules

- A trade station must be built at a vertex where roads from both players meet. It costs the same resource cards as a settlement: one lumber, brick, wool and grain. Each station allows each player to give their partner one resource card per own turn.
- Paid roads and Road Building card roads require the acting player's own road or building. A teammate's road or building cannot support new construction; a trade station is not a road anchor.
- Keep two snake-order placement opportunities per player. Player 1 (seat 0) places one settlement and two roads each time. Player 2 (seat 1) places one city each time, without free roads. Therefore the initial totals are two settlements/four roads versus two cities/no roads, independent of the randomly selected first mover.
- Show the first delivery order as soon as the game starts, during placement. It requires two different resource types and allows seven complete team rounds.
- Thereafter add one new order every three team rounds. Requirements increase and deadlines shorten. Deliver ten of the twelve total orders to win together.

## Reversible implementation choices / first-play tuning

A round means one normal turn per partner. Setup does not consume deadline time. Order arrivals are rounds 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31 and 34. The first order has one card of each of its two types. Total cards then increase by one per order: 2 through 13. Resource diversity rises from two to three to four to five types every three orders. Deadlines, including the arrival round, are 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 3, 3 rounds. An order due in round 7 remains deliverable through the second player's turn of round 7 and expires only when round 8 starts.

These numerical choices are tunable initial values, not a balance guarantee. New orders follow the clock, never immediate delivery replacements. Orders may overlap; a new arrival does not delete an older active order. Twelve is a total contract count, not a twelve-game-round time limit. Ten fulfilled orders immediately win; a third missed order immediately loses because ten successes are then impossible. Partial cargo returns to the bank on completion or expiration.

## Station behavior

At least one incident built road belongs to each partner at the exact station vertex. A remote connection elsewhere does not qualify. Either player can pay the full construction cost on their action turn. One station per vertex. Stations are separate communal infrastructure: no victory points, resource production, or settlement-piece consumption. They may coexist with a settlement/city at a junction and do not block normal building placement. No first-station discount is granted.

Build by clicking Station in Actions, then a highlighted vertex on the existing 3D or 2D board. Each built station has one resource-send button per available resource in the order panel. One send means exactly one resource card; the sender must own it. The per-station allowance is independent for both players, may be used immediately after construction, resets on that player's next turn, and cannot be banked. A second station gives one additional send per player turn.

Unlimited player offers/acceptance and gifts are disabled for v2: resources between partners must use the station command and allowance. Bank/port trades are unchanged. Station construction is a safely undoable deterministic action; a transfer clears undo eligibility. Duplicate/stale network commands are rejected by existing authority checks. Station allowance is saved and restored, so refresh/reconnect does not grant another send.

## Existing mechanics retained

Each player's hand, pieces and construction decisions remain separate. The existing union of team roads still carries cargo to a numbered port; independent road ownership for shipping and personal logistics action points were not part of this approved change. Orders still accept partial contributions from either connected partner's own hand. Road construction is owner-specific: both paid and free roads require an owned endpoint building or an adjacent owned road at an unoccupied vertex. A teammate building is not a usable endpoint; the other endpoint may still provide a valid owned connection. Road networks may meet to form a station, but that station never lends ownership or creates construction support. Settlement construction keeps its existing rule; this addition specifically changes road support. First-play starting bonus cards are retained. Second starting building grants adjacent resource cards: one per hex for a settlement, two for a city, subject to bank stock.

Seven retains discards and robber movement without teammate theft. Knight does not steal; Monopoly requisitions up to two chosen cards from the bank; victory-point cards become Year of Plenty. Team orders decide the outcome. Manual 3D view, orange hover, direct board picking, local and online restart/recovery and spectator privacy remain intact.

## Engineering and acceptance

Rules and quota validation are deterministic, host-authoritative and separate from presentation and transport. Station geometry is public-only; no private hand or network credential is passed to the renderer. Bots use their own hand plus public order/road data, can handle the asymmetric setup, build a useful station and make legal capped transfers. No paid service, remote AI, infrastructure redesign or main-branch merge is authorized.

Verification covers owner-only paid/free road support, shared-junction stations without road ownership leakage, legal-target/authority/Bot agreement, both starting seats, setup legality/supplies/conservation, station junction geometry and cost, co-located buildings, independent quotas across stations/players/turns, trade bypass rejection, safe Undo and non-undoable sends, authoritative duplicate/stale messages, checkpoint recovery, order arrivals/deadlines/overlap, escalation, finite twelve-order generation and ten-of-twelve outcomes. Browser tests exercise actual board construction and send buttons, mobile layout, 3D/2D fallback, Bot setup, online guests/spectators, reconnect and same-room restart. Test fixtures remain local-only and are excluded from production bundles.
