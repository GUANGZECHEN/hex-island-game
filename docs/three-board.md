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
