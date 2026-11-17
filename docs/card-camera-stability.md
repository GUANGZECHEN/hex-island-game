# Development-card camera stability

Approved bug fix: playing or resolving a development card must retain the player's current board view. No rules, map generation, random sequence, transport or private projections change.

The rendering instance and static board identity already survive card reducers. However, a canvas size change used to call whole-board `fit()` unconditionally. After orbit/pan/zoom, layout changes (notices, selection controls, viewport dimensions) could therefore replace the selected projection with a newly framed full-board view.

OrbitControls interaction now marks the camera view as manual. Subsequent container resizes preserve camera position, orientation, target, zoom and world-units-per-CSS-pixel; only the orthographic bounds follow the new canvas dimensions. Initial display, a genuinely different board, Reset view and Top view retain explicit auto-fit. Hidden/zero-size containers do not corrupt the stored projection.

Regression coverage uses a disposable fixture generated from the actual game UI and reducers, not a production debug-state setter. It plays Road Building through both free roads and Undo, plus Knight, Monopoly and Year of Plenty, before and after realistic header reflow and container resize. The fixture is deleted before any production build. Read-only 3D diagnostics expose projection/bounds to distinguish view jumps from unchanged camera coordinates.

## 2026-11-17: persistent camera for every gameplay operation

Owner-approved extension: no gameplay action resets or recenters the viewing angle. The old exception for a genuinely different map is superseded. In-game construction, roll/discard, resources, trading, turn transitions, Undo, teammate actions, snapshots and reconnects all retain the local player's position, target, orientation and zoom. Even a new seed/board and a same-room Abort/next match preserve the local view; a brand-new page load initializes its own default camera. 2D/3D view switching temporarily stores and restores the 3D pose. Resizes only adjust the orthographic frustum to keep the same world-units-per-pixel; they no longer trigger whole-board fitting. **Reset view** and **Top view** are the only intentional camera-reframing actions.

The camera is presentation-only and never enters host authority, private hands, checkpoints or room messages. Tests exercise actual renderer state after gameplay, Undo, dice, toggling the fallback, reconnect, restart and new-map selection. A new map with different size might lie partly outside a deliberately zoomed-in camera; Reset view is the explicit way to see the entire map.

## 2026-11-17 trade-induced viewport jump fix

The game previously scheduled `fitBoardToDesktopViewport()` on **every render**, including bank trades, player offers/acceptance and cooperative trade-station gifts. It measured the board's viewport-relative `getBoundingClientRect().top`; scrolling to a trade control made this coordinate change, so the height calculation enlarged or shrank the board. This felt like a camera reset even when the Three.js camera's orbit/zoom fields were unchanged.

The board-stage height is now computed once on entry into the gameplay layout and recomputed only on an actual viewport resize. The calculation uses the stage's **document** position (viewport top + window scrollY), which is scroll invariant. A separate regression test checks the geometry and the absence of per-action refits. The 3D renderer will only fit the board when its canvas gets its **first valid size**; it will never re-fit an existing view after a trade or any other game command, even if a resize cannot produce a valid scaled frustum. The explicit Reset view and Top view buttons retain their intentional behavior.

A real Chromium trade regression exercises a rotated and zoomed 3D view through a 4:1 bank exchange, a player offer and acceptance, and Harbor Co-op station gifts. It also checks the board's CSS height, actual rendered canvas dimensions, camera matrix, target, zoom, static scene identity and rendering instance without exposing hidden cards or backend capabilities. The fixture is temporary and never shipped.
