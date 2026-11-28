# Compact board layout

## Accepted interaction

Keep the existing **Your hand** element immediately above **Actions**, in the same command column. Player statistics remain on the left. On phones, the hand spans the row immediately above the side-by-side Actions and Trade sections. Spectator privacy, Undo placement and existing inputs are unchanged.

## Desktop sizing

The existing viewport-height fit remains authoritative. The layout-only module reads the rendered board height and actual SVG viewBox or Three.js canvas aspect ratio. It bounds the center grid track by both available width and `height * aspectRatio`. The surrounding stage is centered with 8px gaps. At 1100px of available panel width, the player and command columns use 230px and 330px. They grow to 260px and 360px at 1200px, then more gently to 280px and 400px at 1900px. Narrow desktop windows use the lower widths to preserve more map space, while roomy desktops give player information, Actions and Trade more room. Extra monitor width beyond the fitted group remains outside it instead of becoming letterboxing between the island and its controls.

Resize and board replacement are observed without reconstructing controls, mutating game state, sending network messages or resetting selections. The compact width is cleared at the existing 1100px mobile/tablet breakpoint. Standard and expanded maps use their own viewBox dimensions; no map shape is hard-coded.

## Multiplayer preparation

Guests and spectators see only the short **Catch-up resources** and **Harbor ships** labels with their synchronized, read-only checkbox states. Full rule explanations remain visible for the host beside the same settings. The detail text is hidden for other roles, including from the accessibility tree; checkbox labels, readiness, nickname and role controls remain available.

## Validation

`tests/compact-layout.test.ts` covers sizing, invalid measurements and the single hand element's placement. The existing QA workflow still checks TypeScript, game rules, responsive layouts, multiplayer, reconnect and recovery.

The initial compact layout was manually checked in Chromium at 1920x720, 1280x720, 1280x900, 1920x1080, 2560x900, 1101x700, 1024x768, 375x812 and 320x700. Those historical checks covered actual painted SVG bounds, hand-to-Actions adjacency, viewport height fit and absence of horizontal overflow, with the expanded six-player board checked separately at 1920x720.

For the wider desktop columns, the existing compact-action browser QA checks button width relative to its measured two-column action pane rather than enforcing the old 160px cap. Label and cost fit, button height, internal overflow and document overflow checks remain in place. The existing deployment workflows provide current Chromium checks for desktop/mobile layout, lobby roles and multiplayer behavior.

No game-rule, transport, model, permanent Worker or production-branch changes are part of this update.
