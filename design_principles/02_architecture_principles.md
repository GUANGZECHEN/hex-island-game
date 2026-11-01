# Architecture principles

- Separate game logic, UI, and networking.
- Keep game rules deterministic and independently testable.
- Prefer TypeScript, subject to architecture validation.
- Support desktop and mobile browsers.
- Evaluate WebRTC peer-to-peer networking before committing to infrastructure. WebRTC cannot be assumed to work without signaling or TURN.
- Validate networking, reconnection, and state synchronization as architecture risks.
- Avoid premature implementation of unapproved technology choices.
- Do not introduce paid services or external infrastructure without Product Owner approval.

## Approved evaluation decisions

Evaluate Cloudflare Workers and SQLite-backed Durable Objects for managed signaling and temporary room coordination. Actual game traffic should remain peer-to-peer through WebRTC where practical. A host-authoritative game-state model remains the intended architecture; game state is outside Task 00-03.
