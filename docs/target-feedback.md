# Direct board target feedback

Approved UI update: remove the Legal target coordinate dropdown and Use target button entirely. The target area contains only direct click/tap guidance, Cancel selection and a no-legal-target message when needed. No hidden coordinate form is retained.

Legal building, road and robber locations remain pale yellow. The location under the pointer, touch press, or SVG keyboard focus becomes orange. Entering a mode has no automatic hidden-coordinate selection; leaving a preview clears orange. Direct canvas clicks and mobile taps still pass through the existing game validation. The SVG fallback remains keyboard-operable on the board.

Preview is client-local and never submits a move, redraws controls, rebuilds the map or resets the camera. Cancellation, completed moves and mode changes clear obsolete targets. Observers have no gameplay targets.

Browser tests now interact with actual board hit areas, including settlement, road, city, robber, Road Building, Undo, 2D fallback, touch cancellation, camera preservation and multiplayer reconnect. The shared browser-test helper reads only public target geometry and sends real pointer events; it is not imported by production code.
