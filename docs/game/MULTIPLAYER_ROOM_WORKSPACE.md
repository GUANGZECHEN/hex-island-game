# Multiplayer room within the board workspace

Product Owner decision: 2026-11-17. Engineering classification: **complex** (online room lifecycle, client state and persistent checkpoint invalidation).

## User experience

The separate waiting/lobby page is replaced by an in-board setup state after the host creates a room or a guest opens a private invitation. The regular board workspace is immediately visible, with a large live preview of the host-selected map in its center, seat/ready indicators on the side, and the room setup form inside the normal action sidebar. There is no navigation between lobby and game pages. The preview uses the existing deterministic board generator, while the actual game continues to use the existing 3D renderer (and 2D fallback).

The host chooses Classic / Harbor Co-op, standard / expanded map where legal, and the map seed. Guests may view but cannot edit these choices. The existing ready workflow still protects the start action, and changing mode/layout/seed clears readiness. Extra pregame guests may switch between playing and spectating; post-start new invitees continue as public-only spectators.

After a game finishes, the host can choose **Next match · choose mode and map** to return to the setup state. During an unfinished game the same host-only action asks for confirmation and aborts the current match. Everyone stays in the same private room and retains their seat capability. The current game identity and ready flags are cleared; a new game requires everyone to ready up again. The host may then change game mode and map (subject to capacity) and start with a fresh game identity. The existing quick restart on the same map remains available.

## Synchronization and recovery

The host-authoritative session broadcasts a dedicated abort event before the new lobby selection; both host and guests clear old gameplay state and game revision tracking. Any subsequent game uses fresh revision 0. Aborting invalidates the previous game's latest and historical Durable Object checkpoints with a strict, host-authenticated `checkpoint-clear` control. This control preserves the room's credentials, invitation, expiry and live WebSocket peers. The backend still never decides any game rule or game outcome. Unfinished game checkpoints remain recoverable until the host aborts.

Known limitation: the current recovery system persists started games, not unstarted room seating; refreshing the hosting browser during map selection is not guaranteed to recover the pre-start session and seats. Active-game recovery continues to use existing checkpoints.

## Acceptance

- Host and guest enter the normal board workspace before pressing Start; both see the same map preview and current seated players.
- Only host edits mode/map and ends an active match; other players can toggle readiness.
- The same room and seat capabilities survive abort and next-game setup; ready flags reset and stale gameplay commands cannot advance the new match.
- Previous checkpoints cannot resurrect an explicitly aborted game; spectators continue to receive only public projections.
- Classic, Harbor Co-op, local rooms, quick restart, mobile layouts and current-game recovery stay functional.
- CI validation covers room session transitions, the strict checkpoint control and two-browser end-to-end room setup, abort and reconfiguration.
