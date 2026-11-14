# Compact board layout

## Accepted interaction

Keep the existing **Your hand** element immediately above **Actions**, in the same command column. Player statistics remain on the left. On phones, the hand spans the row immediately above the side-by-side Actions and Trade sections. Spectator privacy, Undo placement and existing inputs are unchanged.

## Desktop sizing

The existing viewport-height fit remains authoritative. The new layout-only module reads the rendered board height and actual SVG viewBox ratio. It bounds the center grid track by both available width and `height * viewBoxWidth / viewBoxHeight`. The surrounding stage is centered with 210px of player information, 300px of controls, and 8px gaps. Extra monitor width therefore remains outside the group instead of becoming SVG letterboxing between the island and its controls.

Resize and board replacement are observed without reconstructing controls, mutating game state, sending network messages or resetting selections. The compact width is cleared at the existing 1100px mobile/tablet breakpoint. Standard and expanded maps use their own viewBox dimensions; no map shape is hard-coded.

## Validation

`tests/compact-layout.test.ts` covers sizing, invalid measurements and the single hand element's placement. The existing QA workflow still checks TypeScript, game rules, responsive layouts, multiplayer, reconnect and recovery.

Targeted local Chromium checks were also run against the latest deployed frontend with these exact layout changes: 1920x720, 1280x720, 1280x900, 1920x1080, 2560x900, 1101x700, 1024x768, 375x812 and 320x700. They checked actual painted SVG bounds, hand-to-Actions adjacency, viewport height fit and absence of horizontal overflow. The expanded six-player board was checked separately at 1920x720. Desktop gaps measured approximately 8px on each side, with the hand about 6px above Actions.

No game-rule, transport, model, permanent Worker or production-branch changes are part of this update.
