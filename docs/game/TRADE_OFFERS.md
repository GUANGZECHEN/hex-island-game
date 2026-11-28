# Player-to-player trade offers

## Recipient selection

In Classic multiplayer games, the active player may direct an offer to one named opponent or choose **All other players**. The latter expands to explicit seat IDs in the game command; no wildcard or special broadcast identity is persisted in game state. Every addressed player receives the same private offer card, while spectators and non-addressed players do not receive its contents.

## First acceptance wins

A broadcast offer is one exchange, not a separate copy for every recipient. Each addressed player can accept or reject it. The first valid acceptance processed by the host authority completes the exchange atomically: the two hands are transferred once, the offer is cleared, and the updated snapshot is sent to every player. Later or simultaneous acceptance requests are rejected by the host's monotonic revision check / stale-offer validation, so the same offered cards cannot be spent twice. The other recipients immediately lose the offer. A rejection removes only that player from the target list; the offer remains available to the other recipients. The proposer may cancel the whole offer.

If a recipient does not have enough of the requested resources, their acceptance is rejected without consuming the offer, allowing another recipient to accept. Harbor Co-op continues to use its existing trade-station partner rule and does not expose this domestic trade composer.
