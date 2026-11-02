# Island board geometry prototype

The board is a radius-two axial coordinate set `(q, r)` satisfying `max(|q|, |r|, |q + r|) <= 2`. Iteration is deterministic: ascending `q`, then ascending `r`. Each of the 19 hex IDs is `h:q,r` using signed decimal integers.

The prototype uses pointy-top hexagons. To identify corners without floating-point comparison, each hex center uses integer lattice coordinates `(u, v) = (2q + r, 3r)`. Its six clockwise corners, starting at the top, have offsets `(0,-2), (1,-1), (1,1), (0,2), (-1,1), (-1,-1)`. A vertex ID is `v:u,v`. Adjacent cells derive the same integer coordinates and therefore the same vertex IDs. An edge ID is `e:<vertex-id>|<vertex-id>`, with the two endpoint IDs sorted lexicographically. Neighboring cells reference the same edge and its endpoint vertices. The resulting island has 54 vertices and 72 edges; hex neighbors are derived from shared edges.

The separate presentation mapping converts a vertex to `(x, y) = (u * sqrt(3) / 2, v / 2)` and hex center to `(sqrt(3) * (q + r/2), 3r/2)`. These render coordinates can be floating point; they never determine identity. The SVG uses a padded viewBox and preserves its aspect ratio. The renderer joins stable hex IDs to the seeded terrain and number assignments described in [board setup](BOARD_SETUP.md).

Ports, placement rules, roads and buildings, gameplay state and multiplayer synchronization are intentionally deferred. The board model contains only topology and does not encode these rules. Existing private-room and manual WebRTC diagnostic interfaces remain available.
