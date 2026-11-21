# Effective action clock and host pause

Approved by the Product Owner on 2026-11-21; supersedes the 2026-11-20 interaction-based 30-second clock. Architect implementation classification: `complex` under `docs/orchestration/MODEL_ROUTING_POLICY.md`.

## Operation window

The active player receives **45 seconds** to complete an effective gameplay action. The countdown remains at the upper-right of the existing 3D or 2D board, showing the player's public nickname and remaining seconds. It becomes more prominent at ten seconds. Each successful effective action grants a new 45-second window to the relevant timed player, so a turn can contain multiple actions.

| Operation | Refreshes the clock |
| --- | --- |
| Successful setup placement or paid construction, including ships and trade stations | Yes |
| Successful roll, discard, robber movement, theft or turn/phase completion | Yes for the relevant player; newly obligated players receive their own window |
| Successful development-card purchase/use or free-road placement | Yes |
| Completed bank or port trade | Yes |
| Completed domestic trade accepted by another player | Yes for the active proposer, even though the accepter submitted the command |
| Successful Harbor cargo loading or station gift | Yes |
| Clicking/tapping the board, camera controls, scrolling or keyboard/input changes | No |
| Choosing a construction target without placing it | No |
| Proposing, cancelling or rejecting a trade | No |
| Undo | No |
| Rejected, duplicate, stale or unaffordable command | No |

For simultaneous seven discards, each obligated player has an independent 45-second window. The board shows the nearest outstanding deadline. Submitting one player's valid discard does not extend another player's window. Private pending discard choices remain private.

## Pause and resume

The **room host** may use Pause/Resume during a game, including another player's turn or simultaneous discards. Every outstanding clock freezes at its current remaining milliseconds. Paused games reject gameplay commands and do not execute timeout fallback actions. Guests and spectators see the paused state but have no pause/resume control. Existing camera and viewing controls may remain usable because they do not affect game state or time.

Resume continues the stored remaining time. Repeated pause/resume does not grant another 45 seconds. Paused state is included in synchronized public state and saved recovery metadata, so guest rejoin and restoring a paused checkpoint preserve it. The pre-existing requirement that original players reconnect before the host resumes a saved session remains in place. Starting or restarting a match clears pause and initializes fresh clocks.

Local hot-seat and Bot games expose an equivalent Pause/Resume control. Both the action timer and bot execution stop while paused; pending gameplay inputs are checked again at execution time.

## Authority and timeout behavior

The existing in-browser `HostAuthority` owns multiplayer deadlines, effective-action validation, pause state and automatic fallback actions. Guests and spectators receive display-only remaining durations; clients never supply authoritative elapsed time. Arbitrary activity messages cannot renew a deadline. Pause belongs to the host session control path and is not a guest gameplay command.

When an unpaused operation window expires, the existing validated fallback policy advances the game: end the turn in the action phase; roll with host-controlled randomness; stop unused free roads; choose the first legal setup vertex/road; choose the first legal robber hex or eligible theft target; or discard the required amount in fixed resource order. All choices use the normal reducers, resource conservation and privacy rules. A finished game has no running clock.

The host browser must remain alive and connected for live authority. Background browser throttling can delay the next timeout check. This feature uses existing room transport and bounded recovery checkpoints, with no additional service or scheduling infrastructure.

## Acceptance checks

- Fake-time tests cover the 45-second boundary, effective actions, rejected commands, offer/cancel/reject/Undo, accepted guest trades and independent discard windows.
- Pause tests cover exact remaining time, multiple pause/resume cycles, blocked gameplay and timeouts, host-only authorization, rejoin and saved recovery.
- Real Chromium tests cover local and multiplayer visible countdowns, non-resetting camera/input actions, successful construction, pause/resume, guest and spectator displays, and responsive 3D/2D board controls.
- Existing build, privacy, recovery, trade, Harbor and visual suites continue to run before the approved `game/mvp` publication.
