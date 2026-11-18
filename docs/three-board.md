# Integrated 3D board (Product Owner approved)

## Scope
The default board is Three.js r180/WebGL2 for local and existing host-authoritative multiplayer games. The renderer receives public geometry, placed pieces, player colors and legal targets only. Commands still use the existing reducers and host validation. No game rules, transport, model routing or paid service change.

Desert is a continuous sand-dune surface without props, resource icons or placeholder dash. The rule-required robber remains on its occupied tile. Each port uses the original two coastal vertices: two separate wooden decks connect to distinct points on one small boat. Ratios are printed on boat sails; resource-specific sails also use the existing resource icon; generic sails show only 3:1.

## Interaction and lifecycle
Middle-button drag orbits; Shift+middle pans; wheel on the canvas zooms. Only left clicks pick current legal hit targets. Reset/Top view and camera gestures never issue game commands. Mobile camera gestures require Adjust view; ordinary touch allows page scrolling.

Terrain is cached by a static map key, excluding robber location. Pieces and targets update independently; snapshots preserve the canvas and camera. Hand/Actions adjacency and compact desktop height-fit remain. Rendering is on demand; shared GPU resources are disposed when replaced.

User-selected 2D, unavailable WebGL2 and context loss use the existing SVG renderer with the same current state. The legal-target dropdown remains keyboard accessible.

## Verification
TypeScript, unit tests and production build; pure tests validate dual-deck geometry, dunes, static keys and privacy boundaries. scripts/qa-three-live.mjs exercises actual pixels, ray-picked game commands, Undo, standard/expanded maps, responsive layout, restart, input preservation, fallback, host/guest/spectator sync and reconnect. The legacy qa-e2e.mjs deliberately uses renderer=2d for SVG-specific regression; passing it alone does not count as 3D validation.

Browser tests use software SwiftShader. Physical-device FPS and real-phone touch behavior require device acceptance. qa3d=1 exposes read-only public-scene diagnostics plus deliberate context loss; no hands, credentials, deck or game-state setters.

## City model and camera persistence (2026-11-17)

Cities have a distinct, player-colored two-part fortified town-hall silhouette in the default Three.js renderer: a larger stone foundation, taller keep, slate pavilion roof, warm windows, entrance steps and crenellated tower cap. Settlements keep the original cottage silhouette. Geometries and materials still use the shared ArtAssets caches, and the result is bounded for mobile rendering. The city is presentation-only and does not change hit targets, building pieces, rules, network snapshots or 2D fallback identity.

The camera retains its transform (position, look target, orientation, zoom and orthographic field of view) across **all gameplay operations** and temporary renderer teardown, including the 3D→2D→3D switch and same-room Abort/new game. Only user-activated Reset view and Top view reframe. Container size changes preserve world scale and pose. These parameters are local only and never sent over the multiplayer transport.

## Living board: ocean, boats and playful resources (2026-11-17)

Product Owner approved a small visual-only ambient/interactive layer for the existing 3D game. The depth-gradient sea has broad, low-amplitude vertical swells in the original cached geometry. Shoreline foam is understated and stationary; the moving pale ripple stripes have been removed after visual feedback. Harbor boats very gently roll and bob independently while their **two actual dock connectors remain fixed** to the original coast vertices. Nothing moves harbor hit targets, resource tokens, roads, buildings, terrain tiles, ports or their gameplay IDs.

Tapping a tree, sheep, rock, pile of bricks or wheat patch when no gameplay target mode is active triggers a short local sway/hop. Gameplay target picking always takes precedence; selecting a road, settlement, city or robber disables decorative click reactions. No game state, randomness, private information, websocket message or saved checkpoint contains the animation. Spectators can see the same ambient art; decoration clicks are private to their browser. Existing 2D fallback remains static and fully playable.

Motion is frame-capped to about 20 scene updates per second and pauses when the page is hidden, the board leaves the viewport, or the user requests `prefers-reduced-motion: reduce`. A preference change restores animals and props to their resting pose. The whole scene, cached GPU assets and RAF subscriptions are disposed as before. Camera pose is never reset by a frame or decoration interaction; Reset/Top view remain the only explicit camera reset actions.

Verification includes finite periodic wave/boat math, buffer reuse and port connector stability, decorative resource model hit ownership, pure reaction timing, actual browser pixels, click-based animation, unchanged camera and game action counts, reduced motion and bounded frame rate, plus previous gameplay/reconnect tests.


## Ocean geometry fix: no dark shadows, visible physical swells (2026-11-17)

The dark moving patches came from the old opaque seabed cylinder cap intersecting the animated water surface: its top was at y=-0.185, just below the resting water at about y=-0.178. When a trough dipped below the top face, the seabed showed through. In addition, wave vertices moved but their normals were not recomputed, so the mesh looked flat while the dark overlaps moved.

The seabed is now an **open-sided skirt** with no top cap. Its upper 128 vertices follow the same animated positions as the outer water-ring vertices, creating a seamless solid shoreline. The water's actual vertex heights and surface normals update together, letting lighting reveal its gentle three-dimensional rise and fall. The sea does not receive cast shadows, so underwater geometry or nearby props cannot produce stray black moving blobs. The water remains a single cached graded mesh; no white moving wave decals or gameplay geometry are introduced.

Harbor boats return to their original approved bobbing speed and amplitude (pitch 0.019 rad, roll 0.027 rad, independent ±0.016 height motion). Both docks and port/gameplay coordinates remain fixed. This is presentation-only, preserves camera pose, honors reduced motion and does not change any networking/game rules.


## Dice fall on the board and resource payouts follow the buildings (2026-11-18)

Owner-approved ART pass replaces the central "DICE ROLL" activity popup and its player-wide production table with two physical rounded Three.js dice landing directly on the island. The renderer displays the **actual authoritative two dice values**, not an independently randomized pair with the same sum. Each cube has correctly modeled opposing faces and 21 pips; a short tumble smoothly settles with the correct face pointing straight up. The complete roll event is built from public board/dice/bank state on the local reducer transition or host-authored game snapshot; it never changes the roll, consumes private hands, changes rules or sends messages. A newly opened/rejoined spectator does not replay an old historical roll. The existing dice status/log remains accessible without showing a central modal.

As dice settle, every numbered resource hex matching the sum except the robber-blocked hex plays its **existing click reaction** (trees, sheep, rocks, bricks or wheat). Production rewards follow exactly the existing public bank-shortage rules via `calculateDiceProduction`. One compact sprite per earning settlement or city floats above that building, with the earning player's color as outline/text, shared resource icons and exact numbers such as +1 or city +2. No phantom rewards for blocked hexes, an empty bank or a 7. In Harbor Co-op a 7 still follows existing special rewards, without falsely crediting a hex production.

Three.js dice/sprite GPU materials are disposed at animation completion; effects do not alter the camera, board identity or raycast targets. Animation runs independently of the persistent map; normal transactions/turn changes don't reset the camera. Reduced-motion users see settled dice and static gain labels briefly, without tumbling. 2D/WebGL-fallback shows matching on-board dice, resource pulses and player-colored gains. CI verifies actual cube face orientation, all possible sums, payout totals, normal/7/robber cases, colors, 3D camera stability, 2D fallback and original multiplayer tests.


## Multiple producing hexes at one house (2026-11-18)

A roll can activate multiple equal-number tiles touching the same settlement or city. Show **each resource type separately**, with its own recognizable, correctly colored resource icon and +quantity. For example, wood +1 alongside grain +1 on a settlement, or wood +2 alongside grain +2 on a city. Multiple matching tiles of the same resource aggregate into a single icon with the summed amount (e.g. wood +4). Building reward labels grow horizontally for more resource types instead of clipping or hiding any icons; the badge outline and text retain the owning player's house color. Never display resources the bank did not actually grant.

Harbor Co-op v2 roll-seven awards, which originate from a public bank draw rather than numbered tiles, display the actual granted resource icon above that partner's existing home without pulsing any resource tile. All awards derive from the already-public host-authoritative result. Unit and browser tests explicitly cover adjacent equal-number tiles, different and identical resource types, settlement +1 / city +2, and public seven rewards.
