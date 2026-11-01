# WebRTC connectivity experiment

This is a provisional two-peer diagnostic PoC, not a game or an approved production architecture. Networking and the interface are separate. It uses browser WebRTC DataChannels and manual, non-trickle SDP signaling; no custom backend or TURN server is included. The public Google STUN endpoint `stun:stun.l.google.com:19302` is a test configuration, documented in the [WebRTC peer connection guide](https://webrtc.org/getting-started/peer-connections). STUN does not guarantee connectivity, especially behind restrictive NATs or firewalls. The service is external and its availability is not guaranteed. This experiment provisions no service.

## Run

Requires Node.js 22.18+ (or 24+) and npm. Run `npm install`, `npm run dev`, and open the printed address on both browsers. For two devices, run `npm run dev -- --host 0.0.0.0`, use the host's LAN address and allow access through its firewall. Localhost is a secure context; remote device access over plain HTTP may restrict clipboard access, so select and copy the text manually, or use a trusted HTTPS development setup. Never expose the development server to untrusted networks.

1. Peer A selects **Create session** and waits until connection data appears. Copy it to peer B through a trusted channel.
2. Peer B pastes it and selects **Join with offer**. Wait for the answer and send it back.
3. Peer A pastes the answer and selects **Apply answer**. Once the data channel is open, both can send text. Use **Disconnect / reset** on each side to start over.

The data includes network and session information; only share it with the intended peer. Text is displayed as text, not HTML. There is no peer identity verification, signaling authentication, encryption of copied SDP, persistence, reconnection, automatic signaling, TURN, or game state. WebRTC encrypts the channel transport but an unauthenticated manual exchange cannot prove the remote peer's identity. ICE gathering has a 30-second timeout. A failed/disconnected connection may need a reset and fresh exchange; browsers may take time to detect a remote departure.

See [test plan](TEST_PLAN.md) and [architecture evaluation](ARCHITECTURE_EVALUATION.md). Results and unverified items are recorded there. No automatic signaling option is selected or approved.
