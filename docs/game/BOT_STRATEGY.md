# Local Bot Strategy

The local test bot is deterministic and rule-driven. It does not call an AI service and does not read opponents' hidden resource identities.

## Information boundary

The bot may use:
- the public board, number tokens, roads, buildings, ports, public victory points, played Knights, public hand-size counts and bank inventory;
- its own private resource and development cards;
- the exact contents of a trade offer addressed to it.

It must not inspect another player's hidden resource breakdown or hidden development cards when making a decision.

## Opening placement

Settlement scoring starts with dice production pips, then adjusts for:
- grain and ore value for cities and development cards;
- scarce board resources;
- complementing resources the bot does not yet produce;
- resource diversity and number diversity;
- useful 3:1 ports or 2:1 ports that match strong production.

The second setup settlement therefore tries to repair weaknesses in the first instead of simply choosing the next-highest raw-pip vertex.

Setup roads are scored by the value and distance of future legal settlement sites, so they point toward useful expansion instead of the first edge ID.

## Mid-game engine

Every action phase follows a planned-expansion policy. Settlements and cities are the primary production investments, while roads are infrastructure for reaching future settlement sites.

The bot first ranks multiple legal future settlement vertices using both site importance and the number of new road edges still required. Importance comes from the same production/resource/port score used for settlement placement; distance applies a penalty so a nearby strong site can outrank a marginally better site that needs several roads. The ranking is recomputed every decision, so a target claimed or blocked by another player disappears and the bot automatically switches to the next candidate.

Before a target is connected, the bot may build the next road on the highest-ranked target's shortest legal path whenever it has lumber + brick. It does not need to pre-save the future settlement resources. Longest Road contributes only a small secondary bonus and cannot justify a road outside the expansion plan.

### Saving / reservation

Settlement resource reservation begins only after the planned road network actually reaches a target and that vertex is legally buildable. At that point the bot stops extending the road chain and starts preserving lumber, brick, wool and grain for the settlement; surplus may still be traded to fill the missing resource. Until the target is connected, road progress and immediately affordable city upgrades may happen without pre-reserving the future settlement hand.

Cities remain high-value production upgrades. A city that is already affordable can be built immediately; if the current expansion road is not affordable, an existing city may become the next saving goal.

## Trading and hand management

Bank/port trades are aimed at the highest-value near-term goal and spend genuine surplus first. Resource-card value reflects the bot's current build deficits, board scarcity, production gaps and port access.

When discarding after a 7, the bot preserves cards needed for its preferred near-term build and discards lower-value surplus first.

A domestic offer is accepted only if the bot can pay and the weighted value received is sufficient. Offers from a player who is publicly close to winning require a larger advantage for the bot.

## Development cards

- Knight: saved unless it can gain/take Largest Army, remove the robber from meaningful bot production, or pressure a clearly leading opponent.
- Road Building: used when free roads create meaningful expansion or contribute to a realistic Longest Road attempt.
- Invention: selects resources that complete a high-value city, settlement, development-card or road goal when possible.
- Monopoly: uses public bank depletion plus the bot's own hand to infer the aggregate number of a resource held by opponents. It does not inspect individual hidden hands.

## Robber

Robber placement scores:
- production blocked from opponents;
- opponent public threat level;
- whether a steal is possible;
- grain/ore production value.

Blocking the bot's own production receives a large penalty. Victim selection favors the strongest public threat.

## Determinism

Equal states always produce the same choice. Stable ID ordering breaks exact score ties so QA failures remain reproducible.
