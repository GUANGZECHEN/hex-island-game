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
