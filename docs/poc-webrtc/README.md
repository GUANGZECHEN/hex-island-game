# WebRTC connectivity experiment

This is a provisional two-peer diagnostic PoC, not a game or an approved production architecture. Networking and the interface are separate. It uses browser WebRTC DataChannels and manual, non-trickle SDP signaling; no custom backend or TURN server is included. The public Google STUN endpoint `stun:stun.l.google.com:19302` is a test configuration, documented in the [WebRTC peer connection guide](https://webrtc.org/getting-started/peer-connections). STUN does not guarantee connectivity, especially behind restrictive NATs or firewalls. The service is external and its availability is not guaranteed. This experiment provisions no service.

## Run

Requires Node.js 22.18+ (or 24+) and npm. Run `npm install`, `npm run dev`, and open the printed address on both browsers. For two devices, run `npm run dev -- --host 0.0.0.0`, use the host's LAN address and allow access through its firewall. Localhost is a secure context; remote device access over plain HTTP may restrict clipboard access, so select and copy the text manually, or use a trusted HTTPS development setup. Never expose the development server to untrusted networks.

1. Peer A selects **Create session** and waits until connection data appears. Copy it to peer B through a trusted channel.
2. Peer B pastes it and selects **Join with offer**. Wait for the answer and send it back.
3. Peer A pastes the answer and selects **Apply answer**. Once the data channel is open, both can send text. Use **Disconnect / reset** on each side to start over.

The data includes network and session information; only share it with the intended peer. Text is displayed as text, not HTML. There is no peer identity verification, signaling authentication, encryption of copied SDP, persistence, reconnection, automatic signaling, TURN, or game state. WebRTC encrypts the channel transport but an unauthenticated manual exchange cannot prove the remote peer's identity. ICE gathering has a 30-second timeout. A failed/disconnected connection may need a reset and fresh exchange; browsers may take time to detect a remote departure.

See [test plan](TEST_PLAN.md) and [architecture evaluation](ARCHITECTURE_EVALUATION.md). Results and unverified items are recorded there. No automatic signaling option is selected or approved.

## GitHub Pages deployment

After this change is merged to `main`, the Pages workflow builds and deploys the static app at the expected URL: https://guangzechen.github.io/hex-island-game/ . In repository Settings → Pages, select **GitHub Actions** as the build and deployment source. Repository visibility and plan must permit Pages, Actions must be enabled, and the `github-pages` environment must allow deployment. A repository administrator may need to configure these settings. The workflow can also be run manually from Actions. The URL is not live until a deployment succeeds.

Open that HTTPS URL in two browsers or devices, follow the manual offer/answer steps above, and exchange messages in both directions. Repeat using different networks and a mobile browser as described in the test plan. Diagnostics show aggregate local and remote SDP candidate counts by type, not candidate addresses; counts are not evidence of a selected route or successful connectivity. The copyable offer/answer itself still contains sensitive connection information: exchange it privately and do not paste it into logs or issue reports. Public STUN does not guarantee connectivity; this deployment does not provide TURN.

The manual diagnostic interface remains available at `manual.html`. The main page now offers the automatic private-room experiment; see [private-room documentation](../private-rooms/README.md) for its setup, security assumptions, and tests.
