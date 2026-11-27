# Integrated 3D board (Product Owner approved)

## Scope
The default board is Three.js r180/WebGL2 for local and existing host-authoritative multiplayer games. The renderer receives public geometry, placed pieces, player colors and legal targets only. Commands still use the existing reducers and host validation. No game rules, transport, model routing or paid service change.

Desert is a continuous sand-dune surface without props, resource icons or placeholder dash. The rule-required robber remains on its occupied tile. Each port uses the original two coastal vertices: two separate wooden decks connect to distinct points on one small boat. Ratios are printed on boat sails; resource-specific sails also use the existing resource icon; generic sails show only 3:1.

## Interaction and lifecycle
Middle-button drag orbits; Shift+middle pans; wheel on the canvas zooms. A single left click or tap on a legal target performs the selected action. Reset/Top view and camera gestures never issue game commands. Mobile camera gestures require Adjust view; ordinary touch allows page scrolling.

Hovering over a legal road, settlement, or city placement briefly fades the nearest wheat. Moving away or placing the piece restores the field to its normal appearance. While choosing a robber destination, translucent hex highlights leave the neighboring buildings visible.

Terrain is cached by a static map key, excluding robber location. Pieces and targets update independently; snapshots preserve the canvas and camera. Hand/Actions adjacency and compact desktop height-fit remain. Rendering is on demand; shared GPU resources are disposed when replaced.

User-selected 2D, unavailable WebGL2 and context loss use the existing SVG renderer with the same current state. Legal SVG targets accept keyboard focus and Enter.

## Verification
TypeScript, unit tests and production build; pure tests validate dual-deck geometry, dunes, static keys and privacy boundaries. scripts/qa-three-live.mjs exercises actual pixels, ray-picked game commands, Undo, standard/expanded maps, responsive layout, restart, input preservation, fallback, host/guest/spectator sync and reconnect. The legacy qa-e2e.mjs deliberately uses renderer=2d for SVG-specific regression; passing it alone does not count as 3D validation.

Browser CI uses SwiftShader. The expanded-board benchmark measures the time from a single touch release to the first post-render task showing the completed build, the CPU time to update placed structures, and actual frames while the camera moves. The dense six-seat fixture has 48 roads and 18 buildings and times 20 city upgrades after a warm-up. Physical-device targets are a p95 local response under 100 ms, at least 30 fps during a camera drag on a midrange phone, and a goal of 60 fps on an integrated-graphics laptop.

To repeat on hardware, install the repository dependencies and the same Playwright version used in browser CI (`npm install --no-save --no-package-lock playwright@1.58.0`). From the matching checkout, point `QA_URL` at the running site's full URL and run `node scripts/qa-board-performance.mjs` with an installed Chrome browser. Set `QA_CDP_URL` to an attached Android Chrome debugging endpoint to measure the phone. The JSON output includes GPU, viewport, sample counts and timings. The benchmark uses a fresh tab for local play.

qa3d=1 exposes read-only public-scene diagnostics plus deliberate context loss; no hands, credentials, deck or game-state setters.

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

As dice settle, every numbered resource hex matching the sum except the robber-blocked hex plays its **existing click reaction** (trees, sheep, rocks, bricks or wheat). Production rewards follow the full unlimited-bank awards computed by `calculateDiceProduction`. One compact sprite per earning settlement or city floats above that building, with the earning player's color as outline/text, shared resource icons and exact numbers such as +1 or city +2. Blocked hexes and a 7 grant no ordinary tile production; bank ledger values never suppress payouts. In Harbor Co-op a 7 still follows existing special rewards, without falsely crediting a hex production.

Three.js dice/sprite GPU materials are disposed at animation completion; effects do not alter the camera, board identity or raycast targets. Animation runs independently of the persistent map; normal transactions/turn changes don't reset the camera. Reduced-motion users see settled dice and static gain labels briefly, without tumbling. 2D/WebGL-fallback shows matching on-board dice, resource pulses and player-colored gains. CI verifies actual cube face orientation, all possible sums, payout totals, normal/7/robber cases, colors, 3D camera stability, 2D fallback and original multiplayer tests.


## Multiple producing hexes at one house (2026-11-18)

A roll can activate multiple equal-number tiles touching the same settlement or city. Show **each resource type separately**, with its own recognizable, correctly colored resource icon and +quantity. For example, wood +1 alongside grain +1 on a settlement, or wood +2 alongside grain +2 on a city. Multiple matching tiles of the same resource aggregate into a single icon with the summed amount (e.g. wood +4). Building reward labels grow horizontally for more resource types instead of clipping or hiding any icons; the badge outline and text retain the owning player's house color. Never display resources the bank did not actually grant.

Harbor Co-op v2 roll-seven awards, which originate from a public bank draw rather than numbered tiles, display the actual granted resource icon above that partner's existing home without pulsing any resource tile. All awards derive from the already-public host-authoritative result. Unit and browser tests explicitly cover adjacent equal-number tiles, different and identical resource types, settlement +1 / city +2, and public seven rewards.


## Raised dice, audio, smaller city, optional Classic rules (2026-11-18)

When a dice roll is committed, the old “It's [name]'s turn” board notice disappears before the first animated dice frame. Two actual warm ivory dice throw and settle on a small raised game-table dice platform above resource models, tokens and hex tiles. Faces 1 and 4 use **recessed red pip wells**; 2, 3, 5 and 6 use recessed blue wells. The shown upper faces always equal the two host-generated die values. No visuals roll extra game random numbers. A short, locally synthesized dice-clatter sound accompanies the throw, controlled by a persistent per-browser mute toggle on the game control panel; the audio works only when allowed by the browser user-gesture policy. The 2D fallback uses the same face colors and inset appearance, without 3D geometry.

All gain labels above buildings are larger and always show one resource icon plus exact +quantity per resource type, merging repeated instances of the same resource. The badge border/text use its owner's player color, while the icon has a resource-specific color. A downsized city model is still distinct from the settlement but removes its two tall paired windows and uses one restrained horizontal hall window.

Two new optional, **Classic-only**, host-chosen lobby toggles are synchronized to every player and spectator and are stored in authoritative state/recovery: Catch-up resources (after own roll, let x be the highest public VP: a roller at <= x - 3 VP receives 1 random bank resource when x is 5, 6 or 7, or 2 different resources when x > 7; no award when x < 5), and Harbor ships (owned port prerequisite, 2 lumber + 2 brick + 2 ore, legal vacant harbor vertex respecting building spacing, with no connecting road needed, 1 VP and settlement-level production/port trade, blocks neighboring construction but never anchors roads). Harbor Co-op continues using its own approved rules. No hand identities or new network services are exposed.

On seven, discard obligations are determined before the Catch-up award. Normal production labels contain production only. Once the roll presentation completes, a separate central `<player name> gained supplement` notice shows the actual awarded resource icons and quantities in 3D and 2D. Repeated renders and snapshots do not replay the notice or grant cards. This corrects the original Catch-up thresholds and presentation (approved 2026-11-22).

## Two ship pieces per player; three-face isometric dice (2026-11-19)

A Classic player with the optional Harbor Ships rule may build at most two ships in the entire match. A read-only remaining-count helper derives supply from the authoritative number of that player's existing ship buildings, so all clients/spectators, reconnects and checkpoint recovery agree without a new field. The server-side build reducer rejects a third ship, even for crafted commands. The hand and public player strips display **ships remaining** (2 / 1 / 0) rather than a misleading built count; the build action is hidden once none remain, while an authorized Undo restores a piece. Normal ship costs, no-road placement, port benefits and 1 VP are unchanged.

Dice have polished ivory rounded bevels with light-catching clearcoat, a warm and cool fill light, inset red dots on 1/4, blue dots on 2/3/5/6, subtle well glints and face perimeter shading. At rest, a camera-aware local cube rotation faces **two lateral faces as well as the true upward authoritative face** toward the viewer, including from a near-top-down board camera. This is a die-only display transform; it never rotates or resets the board camera. The cube's support height is computed from its exact rotated extents, keeping it physically above the tabletop tray without clipping. Unit tests cover all six top values under four camera angles and visible three-face geometry, and real Chromium verifies both normal and Top view renders.

## Floating dice, no support tray (2026-11-19)

The Product Owner has superseded the earlier raised dice-platform presentation: **the tray, circular rim and all board-obscuring supports are removed**. During each roll, only the two polished 3D dice appear suspended above the existing board, and their landing heights still clear the terrain and resource props. No new pedestal, plate, shadow-catching surface or decorative object is added. Face values and three-face viewing angles, recessed colored pips, animation, sound, resource payouts, camera behavior and 2D fallback are unchanged. 3D unit tests assert the dice layer contains no support or tray meshes.

## Shorter dice animation and three impacts (2026-11-19)

The owner requested a quicker throw and only three audible collisions. The on-board 3D dice now settle after **800 ms** (previously 1150 ms) and the dice themselves disappear after **1800 ms** (previously 2450 ms); resource gain badges remain until **2600 ms** so payouts stay readable. Reduced-motion mode displays the already-settled result for 1000 ms. Exactly three short synthesized impacts play at 70, 300 and 630 ms, with the existing per-browser mute switch unchanged. The SVG fallback dice drop has been shortened to match; its dice vanish after 1800 ms but the resource labels remain for the same additional reading time. The two dice remain **floating with no tray or support**, and all values, production, turn rules, camera behavior and networking remain unchanged.

## Ship button visibility and prerequisites (2026-11-19)

In Classic action turns, an enabled Harbor Ships rule now **always displays Build ship**, even if the player lacks some materials, a port, a legal vacant port vertex, or remaining ship pieces. The action is disabled with an explicit reason whenever any requirement is missing; its full cost (2 wood, 2 brick, 2 ore) and the remaining two-piece limit remain visible. If the optional rule was not enabled in the lobby, a player holding the full ship cost also sees the disabled action explaining the host must enable the rule before the game. When all requirements are met, the action opens the existing highlighted legal harbor targets. Placement validity, authoritative reducers, distance rule, port ownership, supply limits, game modes and networking are unchanged.

## Remote ship construction without roads (2026-11-19)

The owner removed the road-connection requirement for optional Classic ships, allowing a remote harbor presence distinct from road-connected settlements. The authoritative build command and highlighted legal targets accept any vacant port vertex without adjacent owned roads, provided the player already owns a port, has sufficient resources and a remaining ship, and respects settlement-style spacing. The existing action button explains unmet prerequisites rather than disappearing. Other ship benefits and all Harbor Co-op construction/Load rules are unchanged.

## Harbor ship cost adjustment (2026-11-20)

The Product Owner reduced the optional Classic Harbor Ships construction cost from 3 lumber + 3 brick + 3 ore to **2 lumber + 2 brick + 3 ore**. The authoritative cost constant is reused by the gameplay reducer and Actions affordability/cost display, while insufficient-material hints use the new thresholds. The already-owned port prerequisite, remote placement without roads, spacing, maximum two ships, 1 VP, settlement-level production and port trading are unchanged. This release uses an independent QA concurrency group to avoid interrupting the already-running five-hour test session. This historical cost was superseded by the 2026-11-22 amendment below; all non-cost terms remain unchanged.

## Harbor ship cost adjustment amendment (2026-11-22)

The Product Owner further reduced the optional Classic Harbor Ships construction cost from the historical 2 lumber + 2 brick + 3 ore to **2 lumber + 2 brick + 2 ore**. This is a cost-only amendment: the already-owned port prerequisite, remote placement without roads, settlement-distance spacing, maximum two ships, 1 VP, settlement-level production, port trading and non-road-anchoring behavior remain unchanged. The authoritative cost constant, Actions affordability/cost display and insufficient-material hints use the 2 lumber + 2 brick + 2 ore thresholds. Harbor Co-op rules remain unchanged.
