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

Every action phase follows a building-first policy. Settlements and cities are the primary investments because they claim or multiply production. When both are realistic, the bot finishes the building with the smaller resource gap; an equal gap favors a settlement because it claims new production. Development cards are discretionary spending after building goals. Roads are infrastructure for a concrete settlement plan, not a destination by themselves.

A normal paid road must have strong settlement-expansion value. Longest Road contributes only a small secondary bonus and cannot justify ordinary road spam by itself. Even with surplus lumber and brick, the bot normally waits until it has the complete road + settlement resource package before laying the expansion road, so the road is quickly followed by a house.

### Saving / reservation

When a legal settlement or city exists, the bot creates a building saving goal even if it needs several future rolls. Cards required by that build are treated as reserved: lower-value roads or development-card purchases may not consume them. The bot first tries a bank/port trade using genuine surplus to fill the missing resource; if no useful trade exists, it ends the turn and keeps saving. When expansion requires a road before the settlement is legal, the bot may reserve the combined road + settlement package and spend the road only as part of that expansion plan.

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
