# Development-card camera stability

Approved bug fix: playing or resolving a development card must retain the player's current board view. No rules, map generation, random sequence, transport or private projections change.

The rendering instance and static board identity already survive card reducers. However, a canvas size change used to call whole-board `fit()` unconditionally. After orbit/pan/zoom, layout changes (notices, selection controls, viewport dimensions) could therefore replace the selected projection with a newly framed full-board view.

OrbitControls interaction now marks the camera view as manual. Subsequent container resizes preserve camera position, orientation, target, zoom and world-units-per-CSS-pixel; only the orthographic bounds follow the new canvas dimensions. Initial display, a genuinely different board, Reset view and Top view retain explicit auto-fit. Hidden/zero-size containers do not corrupt the stored projection.

Regression coverage uses a disposable fixture generated from the actual game UI and reducers, not a production debug-state setter. It plays Road Building through both free roads and Undo, plus Knight, Monopoly and Year of Plenty, before and after realistic header reflow and container resize. The fixture is deleted before any production build. Read-only 3D diagnostics expose projection/bounds to distinguish view jumps from unchanged camera coordinates.
