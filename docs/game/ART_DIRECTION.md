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
