# Private-room signaling experiment

The static Vite site stays on GitHub Pages. A Cloudflare Worker creates a random room ID and separate 256-bit random host and guest capabilities. A SQLite-backed Durable Object per room stores SHA-256 hashes of the capabilities and an absolute 12-hour expiration, and uses hibernating WebSockets for temporary coordination. The host is the WebRTC hub: one peer connection and one data channel per guest, up to three guests. SDP and trickle ICE are routed by the Worker; diagnostic messages travel over the DataChannel, not the signaling socket. No game state, migration, persistence, accounts, reconnection, or TURN is implemented.

## Security and limitations

An invitation URL is a bearer capability. Anyone who receives a valid unexpired invitation may join, subject to room capacity. Forwarding an invitation therefore transfers access. The guest capability is in the URL fragment, not the HTTP request; the guest UI removes it from the address bar on load. The host capability is never included in the invite. Share invitations through a trusted channel and do not post them or SDP or ICE data in logs or issues. There is no identity verification or invitation revocation before room expiry. WebRTC encrypts transport but a bearer invitation does not authenticate the person holding it. Direct WebRTC and STUN can expose network addresses to peers or the STUN provider. A public website URL alone does not provide an invitation.

The Worker validates browser Origin against the Pages origin and HTTP localhost/127.0.0.1 origins with ports; Origin is not authentication and can be forged by non-browser clients. Credentials are sent in the first WebSocket message, not in a URL. Role checks, four-member capacity, expiry and host-only routing are enforced by the Durable Object. SDP, ICE, capabilities and addresses are not intentionally logged. An unauthenticated socket limit provides a basic bound but there is no comprehensive rate limiting or abuse protection; hostile clients who know a room ID may exhaust the pending socket allowance. Cloudflare request logs, proxies, browser extensions and shared devices are outside the application's control. Review provider logging and quotas before public use. STUN alone does not guarantee connectivity and there is no TURN fallback.

## Protocol

`POST /rooms` returns room ID, host credential, guest capability and expiry over HTTPS. Connect to `/rooms/<room-id>/socket` over WSS. On `authenticate`, send `{type:"auth",role:"host"|"guest",token}`. After `ready`, the server sends `join`/`leave` to the host. Participants send `{type:"offer"|"answer"|"candidate",to,data}`; the server forwards it with `from` to the other role only. The host sends offers, guests send answers, and both send candidates. Messages are limited to 32 KiB; malformed messages are rejected. Room ID is not an authorization credential. No sensitive values should be placed in URLs other than the invitation fragment.

## Local development

Requires Node 24 and npm. In `signaling/`, run `npm ci` and `npx wrangler dev --local --ip 127.0.0.1 --port 8787`. In the repository root, run `npm ci` then `VITE_SIGNALING_URL=http://127.0.0.1:8787 npm run dev -- --host 127.0.0.1`. Open the Vite URL; use `http://localhost:<port>` or `http://127.0.0.1:<port>` as allowed origins. For other devices, localhost is not reachable and the allowlist intentionally excludes LAN origins; use the deployed HTTPS environment or deliberately change the allowlist for an isolated local experiment. Without an endpoint, the site builds and shows automatic rooms unavailable; the manual diagnostic page remains available.

## Owner deployment after merge

1. Confirm that the Cloudflare account and Workers/Durable Objects free-plan quotas and limits are acceptable. The repository does not configure billing; the owner must not enable paid services without approval. Create/connect a Workers Builds project from this GitHub repository in the Cloudflare dashboard, following the current Workers Builds UI. No Cloudflare account or API token is included here.
2. Configure the project root/build working directory as `signaling`, install command `npm ci`, and deployment command `npx wrangler deploy`. The checked-in `wrangler.jsonc` defines the SQLite Durable Object binding and migration. Choose the `main` branch for production. Verify the plan supports SQLite Durable Objects and WebSocket hibernation, and review build/deploy settings before enabling automatic deployments.
3. After a successful deployment, copy the HTTPS Worker origin (no trailing path, credentials or query). In GitHub repository Settings → Secrets and variables → Actions → Variables, set `SIGNALING_URL` to that origin. The value is public configuration, not a secret. Ensure Pages uses GitHub Actions and rerun the Pages workflow, or push a subsequent approved change to main.
4. Open the published Pages URL and follow the test plan. The GitHub Pages variable affects future builds only. No deployment or real-network verification was performed as part of this change.

## Manual test plan

1. Open the site in a host browser; create a room and copy its invite. Open it on a second device. Verify the guest joins, the host sees a peer, both DataChannels open, and messages arrive both ways. Test up to three guests. Do not publish the invitation.
2. Try an altered capability, an expired room, a fourth guest, and a guest with the host offline. Verify errors. Close the host and observe guest disconnection; reset and start a new room.
3. Repeat on the same computer, same Wi-Fi, different networks, and mobile browsers. Record browser versions, connection states and aggregate candidate counts only. STUN-only failures are expected on some networks.
4. Build with no endpoint and verify automatic rooms are unavailable and `manual.html` still works. Test the existing manual signaling flow.

No cross-network, mobile, or deployed Cloudflare test is claimed. This remains an experiment and requires an architecture/security review before production use.
