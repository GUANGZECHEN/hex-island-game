# Architecture evaluation (provisional)

This document evaluates options; it does not approve an architecture or provider. The PoC implements manual signaling and two-peer text only.

## Signaling options

Signaling exchanges offers, answers and candidates; it is distinct from the encrypted WebRTC data path and does not itself provide TURN. Published limits and prices can change; check current provider terms before any decision.

| Option | Setup, credentials and free tier | Security and maintenance | TURN |
| --- | --- | --- | --- |
| Managed realtime database, e.g. [Firebase Realtime Database](https://firebase.google.com/pricing) | Moderate: project, SDK, access rules and configuration; Spark has quotas and limitations, paid billing may be needed beyond them. | Authenticate or use carefully scoped short-lived room capabilities; expire SDP, validate sizes, avoid public read/write rules. Vendor SDK, quota and rules need upkeep. | Not included in database signaling; separate STUN/TURN configuration is needed. |
| Serverless endpoint, e.g. [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/) plus suitable temporary storage or messaging | Moderate to high: deploy code, account, credentials and lifecycle management; free plan has request/resource limits, and stateful coordination may have separate limits or charges. | Rate limiting, room authorization, expiry and abuse controls are application responsibilities; maintain code and provider integrations. | Endpoint signaling alone is not TURN. A separate relay and credentials may be needed. |
| Hosted messaging, e.g. [Ably](https://ably.com/pricing) | Moderate: account, client SDK and token service; free tier has limits and eligibility/terms can change. | Avoid embedding privileged keys; issue short-lived scoped tokens and handle room expiry. Vendor availability, pricing and SDK are dependencies. | Messaging alone does not provide TURN; use a separate relay if needed. |
| Manual out-of-band exchange | No account or service needed beyond transfer channel; cumbersome and unsuitable for room discovery. | Share SDP only over a trusted channel; identity verification and cleanup are manual. | No TURN; this PoC only configures STUN. |

TURN is not always required, but some network pairs cannot connect without a relay. A production design must decide whether the resulting failure rate is acceptable or configure TURN; relay bandwidth and uptime can incur cost. Do not provision or select services without the required approvals.

## Host-authoritative model

A host could hold authoritative state, validate client actions and distribute ordered updates. This reduces accidental divergence but a malicious host can cheat; peer identity, validation, ordering, duplicate handling, versioning, snapshots and trust require design. Clients should submit intents, not authoritative outcomes. None of this is implemented or validated here.

A 3–4 player star uses one connection per client and 2–3 at the host, concentrating bandwidth and availability at the host. Full mesh uses 3–6 peer connections and increases coordination, but does not itself solve authority or migration. Each connection may need signaling and TURN; relay traffic and costs grow with participants and message volume. Benchmark on mobile and restrictive networks before choosing.

ICE and channel states can signal disconnection, but transient failures and backgrounded mobile browsers complicate timeouts. Reconnection needs identity, fresh signaling, replay/snapshot resynchronization, stale session handling and explicit timeout policy. Host departure ends the authoritative process unless a separately designed migration protocol elects a successor and reconciles state; split-brain and cheating remain risks. Neither reconnection nor migration is implemented.

Open questions for the Architect and Product Owner: acceptable failure rate and relay budget, trusted host assumptions, signaling provider and authentication, mobile background policy, reconnect window, migration requirements, and privacy/retention rules. Measure before approving any choice.
