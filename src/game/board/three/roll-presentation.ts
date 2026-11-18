import { createIslandBoard } from '../geometry.ts';
import { calculateDiceProduction } from '../../rules/turn.ts';
import { RESOURCES, type GameState, type Resource } from '../../rules/state.ts';

/** Public-only event. Never transports hands, cards, RNG or animation timing. */
export interface BuildingRollGain {
  vertexId: string;
  playerId: string;
  resource: Resource;
  count: number;
  kind: 'settlement' | 'city';
}
export interface RollPresentation {
  dice: readonly [number, number];
  hexIds: string[];
  gains: BuildingRollGain[];
}

type PublicBoard = Pick<GameState, 'board' | 'buildings' | 'bank'> & { players: readonly { id: string }[] };

/** Mirror the authoritative resource rules, including robber and bank shortages,
 * then distribute the publicly known award over buildings for display only. */
export function describeRoll(before: PublicBoard, dice: readonly [number, number]): RollPresentation {
  const [first, second] = dice;
  if (![first, second].every(n => Number.isInteger(n) && n >= 1 && n <= 6)) throw new Error('Invalid public dice result.');
  const total = first + second;
  if (total === 7) return { dice: [first, second], hexIds: [], gains: [] };

  const topology = createIslandBoard(before.board.layout);
  const setupById = new Map(before.board.hexes.map(hex => [hex.hexId, hex]));
  const hexes = topology.hexes.filter(hex => {
    const tile = setupById.get(hex.id);
    return !!tile && tile.token === total && tile.resource !== null && before.board.robberHexId !== hex.id;
  });
  const remaining = calculateDiceProduction(before, total);
  const awards = new Map<string, BuildingRollGain>();

  // Same resource-by-resource and hex/vertex traversal as calculateDiceProduction;
  // available bank stock is already resolved in remaining, so no phantom +1s.
  for (const resource of RESOURCES) for (const hex of hexes) {
    if (setupById.get(hex.id)?.resource !== resource) continue;
    for (const vertexId of hex.vertexIds) {
      const building = before.buildings[vertexId];
      if (!building || !remaining[building.playerId]) continue;
      const count = Math.min(building.kind === 'city' ? 2 : 1, remaining[building.playerId][resource]);
      if (!count) continue;
      remaining[building.playerId][resource] -= count;
      const key = vertexId + ':' + resource;
      const old = awards.get(key);
      if (old) old.count += count;
      else awards.set(key, { vertexId, playerId: building.playerId, kind: building.kind, resource, count });
    }
  }
  return { dice: [first, second], hexIds: hexes.map(hex => hex.id), gains: [...awards.values()] };
}

export function isNewRoll(before: { dice: readonly [number, number] | null; turn: number } | null,
                         after: { dice: readonly [number, number] | null; turn: number }): boolean {
  return !!before && before.dice === null && after.dice !== null && after.turn === before.turn;
}
