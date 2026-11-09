# Product scope

## Approved MVP scope

- A browser-based game supporting desktop and mobile.
- Remote multiplayer for 2–6 players, using a host-selected standard 2–4 player board or expanded 5–6 player board.
- Private rooms using invitation links or room codes.
- After a multiplayer game starts, a valid room invitation may join as a live spectator with public-only game information and no gameplay controls.
- Classic base-game Catan-inspired mechanics: a hexagonal map, dice, resource production, construction, trading, development cards, the robber, and victory conditions.
- No account registration required.
- No ranking system. Remote multiplayer has no AI opponents; local play may optionally use one deterministic test bot as Player 2 in a fixed two-player test game.
- Prefer free or low-cost deployment.
- Use original project branding and visual assets.

Detailed rules and implementation choices require the appropriate approved specifications; this scope does not settle them.

## Private-room access

The game website may be publicly accessible. Joining or spectating a private game room requires a valid invitation or capability; possession of the website URL alone does not grant access to a private room. Before game start, invitations may claim an available player seat up to the selected board version's capacity: four seats on the standard board or six seats on the expanded board. After game start, new invite holders join as spectators unless they present an existing player seat capability.
