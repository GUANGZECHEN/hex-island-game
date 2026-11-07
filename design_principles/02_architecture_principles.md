# Architecture principles

- Separate game logic, UI, and networking.
- Keep game rules deterministic and independently testable.
- Prefer TypeScript, subject to architecture validation.
- Support desktop and mobile browsers.
- Use a host-authoritative game-state model for the MVP.
- Use Cloudflare Workers with SQLite-backed Durable Objects as the private-room transport and coordination layer.
- Carry gameplay messages over authenticated WebSockets through the room Durable Object; do not require browser-to-browser WebRTC for normal gameplay.
- Keep the transport boundary replaceable so a future WebSocket backend can move to another host without rewriting game rules.
- Validate networking, reconnection, state synchronization, privacy projection, and room capability handling as architecture risks.
- Do not introduce paid services or external infrastructure without Product Owner approval.

## Approved multiplayer decision

The MVP uses Cloudflare Workers and SQLite-backed Durable Objects for private room creation, authenticated WebSocket connections, bounded message relay, expiry, and temporary room coordination. The host remains authoritative for game state, entropy, validation, and per-player projections. The Durable Object relays messages and does not become the gameplay authority. No TURN, STUN, ICE, or WebRTC DataChannel is required for the standard multiplayer path.
