# Island board geometry prototype

The standard board is a radius-two axial coordinate set `(q, r)` with column sizes 3–4–5–4–3. The expanded 5–6 player board inserts one additional five-hex column horizontally, producing 3–4–5–5–4–3 and 24 total hexes. Iteration is deterministic: ascending `q`, then ascending `r`. Every hex ID is `h:q,r` using signed decimal integers.

The prototype uses pointy-top hexagons. To identify corners without floating-point comparison, each hex center uses integer lattice coordinates `(u, v) = (2q + r, 3r)`. Its six clockwise corners, starting at the top, have offsets `(0,-2), (1,-1), (1,1), (0,2), (-1,1), (-1,-1)`. A vertex ID is `v:u,v`. Adjacent cells derive the same integer coordinates and therefore the same vertex IDs. An edge ID is `e:<vertex-id>|<vertex-id>`, with the two endpoint IDs sorted lexicographically. Neighboring cells reference the same edge and its endpoint vertices. The standard island has 54 vertices and 72 edges. The expanded island has 66 vertices and 89 edges. Hex neighbors are derived from shared edges in both layouts.

The separate presentation mapping converts a vertex to `(x, y) = (u * sqrt(3) / 2, v / 2)` and hex center to `(sqrt(3) * (q + r/2), 3r/2)`. These render coordinates can be floating point; they never determine identity. The SVG uses a padded viewBox and preserves its aspect ratio. The renderer joins stable hex IDs to the seeded terrain and number assignments described in [board setup](BOARD_SETUP.md).

The board model contains topology only; setup, ports, placement rules, buildings and multiplayer state are defined in separate modules. Existing private-room and manual WebRTC diagnostic interfaces remain available.
