# Room connection reliability

The temporary room service remains authoritative for room authentication and relaying; the host remains authoritative for game state, the effective-action turn clock, and pause. Heartbeat traffic is transport control and never changes a game revision or refreshes a turn deadline.

A server advertises heartbeat support with `heartbeat: true` in its authenticated `ready` message. Only then does the client send `{type: "ping", id}` with a nonnegative safe integer ID and expect `{type: "pong", id}`. Servers without this advertisement retain the previous behavior. The client probes after 25 seconds and considers an unanswered probe failed after 20 seconds while visible. Hidden tabs continue to send probes when JavaScript runs; a hidden timeout defers failure and a visible page gets a fresh probe and grace period. On `online`, `pageshow`, or becoming visible, an active supported connection is probed immediately; a scheduled reconnect is expedited. A stale valid pong is ignored and does not satisfy a newer probe.

WebSocket connection and authentication have a 15-second timeout. Room creation has a 15-second request/response timeout per endpoint. Errors, close events, and timeouts converge on the same cleanup path, including when a browser never fires `close`. Reset cancels pending attempts and removes timers and wake listeners. Retry policy continues beyond the initial fast period, preserving room and seat credentials. An initial room join continues to use its existing bounded retries.

When a host transport fails, all its peers are removed from the session together before the lobby is announced. This prevents an announcement from targeting another peer on the failed transport; session state is still cleaned up and retry is scheduled if an application callback fails. Normal relay sends retain their existing validation and failure behavior. A dropped host relay does not pause or restart the game clock.

## Temporary QA ingress

After acceptance, monitoring keeps the existing temporary tunnel URL and backend processes through transient HTTP probe failures. It reports an outage once and records recovery when probes succeed. The monitoring budget is 18,000 seconds of wall-clock time; if either process exits, monitoring ends rather than allocating a replacement. The entire QA job, including earlier setup and acceptance work, has a 355-minute limit. These limits do not guarantee continuous availability.
