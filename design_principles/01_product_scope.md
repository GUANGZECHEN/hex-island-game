# Product scope

## Approved MVP scope

- A browser-based game supporting desktop and mobile.
- Remote multiplayer for 2–6 players, using a host-selected standard 2–4 player board or expanded 5–6 player board.
- Private rooms using invitation links or room codes.
- After a multiplayer game starts, a valid room invitation may join as a live spectator with public-only game information and no gameplay controls.
- Classic base-game Catan-inspired mechanics: a hexagonal map, dice, resource production, construction, trading, development cards, the robber, and victory conditions.
- No account registration required.
- No ranking system. Remote multiplayer has no AI opponents; local play may optionally use one to five deterministic test bots, with Player 1 as the only human viewer. Bot count determines total local player count as one human plus the selected bots; five or six total local players use the expanded 5–6 player board automatically.
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

**Catch-up resources:** After a player's own dice roll (including seven), if any player has at least five publicly visible victory points and the current roller has three or fewer, give that roller one randomly chosen stocked bank resource. Once the leader reaches six or more, give two **different** stocked resource types where available. The host owns the random draws; award stock is removed from the bank, recorded as public per-roll metadata, and shown with the actual resource icons. It does not alter robbery, discard or production rules. Hidden development VP are not used for the public threshold.

**Harbor ships:** A player who already owns a port may pay two lumber, two brick and three ore to add a ship to any vacant port vertex that satisfies the settlement-distance constraint. **No road connection is required**, allowing remote harbor construction independently of the player's roads. A ship occupies that vertex and blocks construction at adjacent vertices; it provides one victory point, one (settlement-level) resource per active neighboring resource tile, and access to that port's trade ratio. A ship can never be upgraded to a city, anchor a new road, or continue a longest-road traversal. Each player has a maximum supply of **two ships per match**. A third ship cannot be built; a valid Undo restores its piece. This supply cap is enforced in the game reducer and reflected in public player controls. Finite legal harbor vertices still apply. This rule adds no new network service or game mode.
