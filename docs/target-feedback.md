# Orange target feedback

Approved UI-only change: legal building/road/robber locations remain pale yellow; the currently hovered, keyboard-focused or selector-selected target is orange. The selected default is the value displayed in the Legal target selector. Hover temporarily takes precedence, and leaving returns to the selected target. City upgrades receive the same feedback.

3D uses a dedicated orange target material, leaving the shared yellow material untouched. Preview updates only target materials and schedules an on-demand frame; they do not rebuild the board, reset the camera, redraw the controls or submit game commands. Existing click-to-place and Use target behavior remain unchanged. Touch press previews the hit target; cancellation/scrolling does not place a piece. Selection and legality are validated again through the existing commands.

Selection is local to each client, clears when targets/mode become invalid, survives renderer switching when still legal, and is absent for spectators. SVG fallback uses matching target IDs and scoped styling. Regression tests cover selection precedence, invalid IDs, cleanup, actual 3D pointer/selector interactions, camera stability, SVG keyboard/fallback behavior, and touch cancellation. Disposable fixtures used to reach city and robber phases are removed before building production files.
