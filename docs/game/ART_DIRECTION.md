# ART-A01 Board Art Direction

ART-A01 upgrades the board presentation without changing game rules, topology, networking, target IDs, or interaction semantics.

## Direction

The board uses a modern illustrated tabletop style with light hand-drawn natural detail. It stays readable and flat enough for browser/mobile play while adding the visual depth of physical board components.

## Terrain

Each hex has four presentation layers:
1. a subtle lower shadow;
2. a warm board-piece edge;
3. a terrain-specific gradient fill;
4. low-contrast terrain illustration.

Terrain motifs:
- Forest: deep green layered tree crowns and trunks.
- Hills: warm brick-orange rolling ridge lines.
- Pasture: light green rolling grass and small grass details.
- Fields: gold wheat stalk lines.
- Mountains: cool gray-blue mountain ridges with light snow accents.
- Desert: warm sand gradients, dune curves, and a small sun accent.

Resource icons remain the shared original project SVG vocabulary and sit above terrain illustration so gameplay identity stays clear.

## Ocean and ports

The SVG contains its own muted blue-green ocean gradient and low-opacity wave pattern. Ports remain connected to their coastal vertices, with warmer physical-token styling so they visually belong to the board without becoming the primary focus.

## Number tokens

Number tokens use a warm paper/wood-chip treatment with:
- a lower shadow;
- outer rim and inner rim;
- strong numeric typography;
- probability pips;
- red number/rim/pips for 6 and 8.

## Robber

The existing prohibition-sign concept is retained. It is presented as a raised cream token with a red ring/slash, highlight, and shadow. The occupied hex remains dimmed while the robber stays fully legible.

## Player pieces

Roads render as three-layer wooden pieces: dark lower edge, player-color body, and a soft top highlight. Settlements and cities use the approved B3 silhouettes with solid player-color material, darker edges, light highlights, and a small table shadow. City presentation is about 1.38× the settlement size for stronger board-level distinction.

Player colors support all six seats.

## Motion

Only board-local motion is included in ART-A01:
- newly built roads draw in;
- new settlements/cities pop into place;
- a moved robber settles onto its destination.

Animations are short and decorative. Reduced-motion preferences disable them.

## Readability constraints

- Terrain illustration stays below gameplay symbols and tokens.
- 6/8 remain the strongest number-token emphasis.
- Legal target highlights are brighter than decorative art.
- Mobile reduces illustration opacity and keeps component silhouettes legible.


# ART-B01 Control Surface

ART-B01 extends the ART-A01 tabletop language from the board into gameplay controls without changing action availability, rule flow, or navigation structure.

## Player boards

Public player cards use a warm paper surface with a stronger seat-color edge, raised seat marker, compact public statistics, and a dashed piece-supply divider. Active-turn treatment uses a restrained gold table highlight. Longest Road and Largest Army holders receive explicit gold award badges in addition to their highlighted counters.

## Private hand

The private hand is presented as a player tray. Resource chips use resource-specific tinted paper tokens while preserving the shared SVG resource symbols and numeric counts. Development cards use a compact physical-card treatment. The tray receives a subtle gold edge on the local player's active turn.

## Controls

Actions remain in the same Actions tab and preserve the existing click flow. Buttons use tactile paper/wood surfaces with semantic visual families:
- dice / primary turn actions: gold;
- road, settlement and city: green construction surface;
- development cards: muted violet;
- trade: blue-green exchange surface;
- end turn: neutral warm surface.

Costs remain attached to their action buttons. Disabled actions stay visibly disabled and retain their existing explanatory title/ARIA behavior.

## Tabs

Actions, Trade and Status / log remain the only control tabs. They use a compact segmented-control treatment and all three receive local SVG icons.

## Trade

Bank and port exchanges are presented as an exchange tray. 2:1 port rates receive the strongest gold treatment; 3:1 rates receive a secondary green treatment; 4:1 bank exchanges stay neutral. Domestic offers use a separate paper card and the existing resource steppers.

## Status

Players, bank, bonuses and game log use quiet paper blocks to improve scanning without changing their content.

## Responsive constraints

At phone widths the same components compact rather than introducing new navigation. Hand tokens, action buttons, bank trades and badges reduce padding/size while preserving touch targets and readable counts.

# ART-C01 Motion

ART-C01 unifies short gameplay motion across the ART-A01 board and ART-B01 control surface. Motion is presentational only: it never delays rule execution, blocks input, changes authority, or introduces hidden information.

## Timing language

Most motion stays between roughly 140–600 ms:
- panel reveal: about 140 ms;
- road placement: about 320 ms;
- settlement/city placement: about 300 ms;
- robber settle: about 380 ms;
- turn handoff entrance: about 320 ms;
- dice tumble: about 580 ms;
- public development-card flip: about 580 ms.

Victory remains the intentional exception and keeps its multi-second celebration.

## Dice

A public dice roll adds two physical dice to the existing board-centered activity alert. Their faces use the actual authoritative dice values. The dice tumble visually, settle quickly, and disappear with the normal activity alert. No extra random value is generated by the animation.

## Development cards

Playing a public development card adds a short card-flip visual with the public card type and existing local SVG icon. Buying a development card uses the same motion with a generic card back; its hidden type is never exposed.

## Board pieces

Road draw-in, settlement/city placement and robber settle continue directly on the board and share the same easing/timing family. Motion must not change piece geometry, target IDs, or interaction hit areas.

## Turn and controls

The existing turn handoff alert and three-pulse active-player cue remain. The player name receives a small settle motion, and switching between existing control panels uses a very short fade/slide.

## Accessibility

prefers-reduced-motion: reduce disables dice tumble, card flip, panel reveal and the decorative board-piece/turn motion while retaining all static state and alerts.


# ART-FINAL Ports and Board Polish

ART-FINAL closes the board-art pass by replacing floating circular port badges with coastal dock components and aligning their material depth with tokens, roads, buildings and the robber.

## Ports

Each port remains bound to the same two coastal vertices used by game rules. Visually, those two vertices now feed into two short wooden pier legs and a central dock stem. The dock itself is a small plank board that sits close to the shoreline instead of floating as a circular UI badge.

Resource-specific ports show the shared local resource SVG plus a 2:1 label. Generic ports use a small anchor mark plus 3:1. Trade information stays upright even when the physical dock rotates around the island coast.

A very small boat silhouette may appear beyond the dock on desktop as decorative coastal context. Phone layouts hide plank micro-detail, bollards and the boat while retaining the dock shape, resource/anchor symbol and trade ratio.

## Consistency pass

Port shadows, number-token shadows, robber-token shadows, building shadows and road shadows share a restrained physical-component depth. Port information stays below legal-target emphasis and must not obscure vertices, roads, number tokens or buildings.


## ART-FINAL refinement: dock spacing and terrain semantics

Port docks sit farther outside the island and no longer route both coastal vertices into one shared stem. Each of the two coastal vertices connects directly to a different end of the same dock. A small tangent offset makes the two pier legs naturally unequal in length and prevents the dock board from visually covering their junction.

Brick-producing hills use a stronger red-clay quarry language: exposed clay faces, stepped quarry cuts and small stacked-brick details. Ore-producing mountains use exposed angular rock faces, quarry benches and loose rubble. These background cues strengthen resource recognition while remaining subordinate to the resource icon and number token.
