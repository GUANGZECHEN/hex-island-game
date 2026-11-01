# Test plan and results

## Automated checks

Run `npm run typecheck`, `npm run build`, and `npm test`. The tests cover valid SDP envelope round trips and invalid input; they do not simulate WebRTC. Type checking, the production build, and serialization tests passed in this task environment on Node 24.19.0.

## Manual procedure

For every scenario, follow the offer/answer steps in the README, confirm both show an open channel, send distinct text in each direction, verify receipt, then reset both. Record browser versions, networks, status and errors, without publishing SDP or IP addresses.

1. **Two tabs, one computer:** open the app in two tabs and complete the exchange.
2. **Two devices, same Wi-Fi:** open the host's LAN URL on both devices and repeat. Check firewall and use manual copy if clipboard is unavailable.
3. **Different networks:** use a safe HTTPS deployment only when separately authorized, or otherwise provide a trusted accessible host. Exchange data over a trusted out-of-band channel. Record failures as well as successes; STUN alone cannot traverse every NAT.
4. **Mobile:** repeat on the intended Android and iOS browsers. Check responsive layout, paste, and manual copy. Backgrounding may suspend the browser.
5. **Failure and disconnect:** paste malformed and wrong-type data, attempt to send before connection, reset during gathering, close a tab, and observe both status and recovery. Establish a fresh session after resetting both peers. A remote disconnect can take time to detect.

## Results

Cross-device, cross-network and mobile testing have not been performed. No cross-network success is claimed. A local two-page headless Chromium 154 attempt exchanged offer and answer, but neither browser gathered an ICE candidate in this execution environment; the channel remained connecting and bidirectional messages could not be verified. This does not establish behavior on a normal desktop or other network. Behavior depends on browser, network and STUN availability.

## GitHub Pages browser test

After a successful Pages deployment, open https://guangzechen.github.io/hex-island-game/ in both peers. Complete the offer/answer exchange and send a unique message in each direction. Repeat on same-device tabs, same Wi-Fi, separate networks and mobile browsers. Record browser versions, connection states and aggregate candidate counts/types; do not record or share SDP, IP addresses or connection data in public reports. Verify reset and retry, and note that zero candidates, restrictive NATs and blocked UDP can prevent connection. Deployment and these tests remain unverified until actually performed.
