# Product scope

## Approved MVP scope

- A browser-based game supporting desktop and mobile.
- Remote multiplayer for 2–6 players, using a host-selected standard 2–4 player board or expanded 5–6 player board.
- Private rooms using invitation links or room codes.
- After a multiplayer game starts, a valid room invitation may join as a live spectator with public-only game information and no gameplay controls.
- Classic base-game Catan-inspired mechanics: a hexagonal map, dice, resource production, construction, trading, development cards, the robber, and victory conditions.
- No account registration required.
- No ranking system. Remote multiplayer has no AI opponents; local play may optionally use one to five deterministic test bots, with Player 1 as the only human viewer. Bot count determines total local player count as one human plus the selected bots; five or six total local players use the expanded 5–6 player board automatically. In two-player Harbor Co-op, the human occupies the city-start seat and the single teammate Bot occupies the settlement-and-roads seat.
- Prefer free or low-cost deployment.
- Use original project branding and visual assets.

Detailed rules and implementation choices require the appropriate approved specifications; this scope does not settle them.

## Private-room access

The game website may be publicly accessible. Joining or spectating a private game room requires a valid invitation or capability; possession of the website URL alone does not grant access to a private room. Before game start, invitations may claim an available player seat up to the selected board version's capacity: four seats on the standard board or six seats on the expanded board. After game start, new invite holders join as spectators unless they present an existing player seat capability.

## Harbor-order cooperative mode (2026-11-15)

The Product Owner approved adding a distinct two-player harbor-order mode while retaining Classic. It supports two humans online, two humans on one device (or one person controlling both seats), and one human with one deterministic local teammate bot. The standard board has exactly two player seats in this mode; invited extras may spectate. Existing host-authoritative transport, private hands, recovery, no-paid-services and automatic-publication-without-main-merge constraints remain unchanged.

Orders, shipping routes and a shared victory/defeat replace individual victory as the cooperative objective. Detailed first-play balance values and explicit adaptations to cards and the robber are recorded in docs/harbor-coop.md. Numerical defaults remain subject to playtest tuning. No remote AI seats, lighthouse campaign or new infrastructure are included.

## Harbor cooperative revision 2 (2026-11-16)

Approved: owned-road/owned-building support only for new roads (including Road Building); settlement-cost trade stations at two-player road junctions; one resource gift per station per player turn; two asymmetric starting placements (Player 1: settlement plus two roads; Player 2: city only); and ten successful deliveries from twelve scheduled orders. The first order appears during setup with two resource types and a seven-round deadline. Further orders arrive every three rounds, increase in size and shorten in deadline. See docs/harbor-coop.md for tuning values and compatibility. Existing v1 saves keep their rules until restart; Classic and infrastructure permissions are unchanged.

## Harbor shipping and seven amendment (2026-11-16)

Approved for Harbor v2: Load may use only the loading player's own roads from their own settlement/city. Trade stations transfer cards, not road access. Rolling seven awards each partner one random resource from available bank stock and immediately resumes normal actions, with no discards, robber movement or theft. Knight's existing behavior, Classic, archived v1 campaigns and infrastructure constraints are unchanged.


## Optional Classic rule toggles (approved 2026-11-18)

The Product Owner approved two independent, host-selected **Classic** rule switches shown to all lobby participants before readiness/start. They default off, are part of authoritative game state and recovery, and are retained for same-room restarts. Existing Harbor Co-op mechanics are preserved unchanged; these two variants are disabled for Harbor Co-op. All gameplay and bot actions use the same host-authoritative reducer and public rule projection.

**Catch-up resources:** Let x be the highest publicly visible VP. After the current player's own roll, award one random stocked bank resource if x is 5, 6 or 7 and the roller has at most x - 3 VP; award two when x is greater than 7, using the same eligibility gap. There is no award below x = 5. When awarding two cards, choose different stocked resource types where available. On seven, determine every player's discard obligation from their hand before granting the supplement. The host owns the draws, deducts bank stock and records the actual award as public per-roll metadata. After dice and normal production gains finish displaying, announce `<player name> gained supplement` with the actual resource icons and quantities. Presentation, repeated snapshots and recovery cannot grant cards again or refresh a clock. Hidden development VP do not count toward the public threshold. The optional Classic-only toggle and Harbor Co-op rules are unchanged.

**Harbor ships:** A player who already owns a port may pay two lumber, two brick and two ore to add a ship to any vacant port vertex that satisfies the settlement-distance constraint. **No road connection is required**, allowing remote harbor construction independently of the player's roads. A ship occupies that vertex and blocks construction at adjacent vertices; it provides one victory point, one (settlement-level) resource per active neighboring resource tile, and access to that port's trade ratio. A ship can never be upgraded to a city, anchor a new road, or continue a longest-road traversal. Each player has a maximum supply of **two ships per match**. A third ship cannot be built; a valid Undo restores its piece. This supply cap is enforced in the game reducer and reflected in public player controls. Finite legal harbor vertices still apply. This rule adds no new network service or game mode.

## Effective action clock and host pause (2026-11-21)

All local and multiplayer game turns use a 60-second window for completing an effective gameplay action. Successful construction, phase progress, card use, resource delivery and completed trades refresh the relevant timed player's window. Clicking, camera movement, editing controls, proposing/cancelling/rejecting a trade, Undo and rejected commands do not refresh it. When another player accepts the active player's trade and the exchange succeeds, the active player's clock refreshes. The top-right board timer is visible to all connected participants and spectators. Each outstanding simultaneous discard has its own independent clock; timeout choices keep private hands private.

The room host may pause and resume an ongoing match. Pausing freezes every outstanding clock at its remaining duration, blocks gameplay commands and automatic timeout actions, and is visible to all clients. Resume continues the remaining duration without granting a fresh window. Reconnection and saved-game recovery retain an explicitly paused match. Local hot-seat and Bot games offer the same pause control and suspend bot actions. The existing host authority, legal timeout fallback commands, private-hand boundaries and deployment infrastructure continue unchanged.

## Harbor cooperative revision 3 (2026-11-21)

Approved: remove development cards from Co-op; change the trade-station construction cost to one wool, one grain and one ore; assign the human to the city-start side in local human-plus-Bot Co-op; and grant both players two different randomly selected resource types, one card each, on seven. The award uses stocked bank types, skips any unavailable second distinct type and preserves the existing roller-first shortage order. Seven still causes no discards, robber movement or theft. Trade-station junction and one-card-per-own-turn allowances, owner-only shipping, asymmetric setup and the twelve-order campaign remain unchanged.

New Co-op games use rule version 3. Saved v1/v2 games retain their recorded rules until restart. Classic development cards, local Classic Bot counts, online human seating, private hands, host authority and existing deployment permissions are unchanged. See docs/harbor-coop.md for current rules and archived versions.

## Twin Capes

Twin Capes is a selectable Classic map for two to six players. Its 25 land hexes surround two lakes of two water hexes each. The capes retain their middle crossing. Three consecutive land hexes connect the north ends and three connect the south ends. One land hex is a desert. The other 24 are productive and use the 18 standard number tokens plus 5, 9, 4, 10, 3 and 11.

The normal Classic robber starts on the desert. A seven requires the usual discards followed by a robber move. Playing a Knight also moves the robber. The occupied tile produces no resources, and the active player steals one random resource from an eligible opponent adjacent to the destination under the ordinary Classic rules. Harbors retain their trading rates.

Sixteen harbors serve the map. Each player has unlimited ships. A ship requires an existing port foothold, a legal port destination and two lumber, two brick and two ore. Each ship earns one public victory point. Games already in progress on the original 29-hex Twin Capes retain their recorded map and blockade-only pirate rules.
