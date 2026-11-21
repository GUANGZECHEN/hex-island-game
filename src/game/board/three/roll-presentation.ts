import { createIslandBoard } from '../geometry.ts';
import { calculateDiceProduction } from '../../rules/turn.ts';
import { RESOURCES, type GameState, type Resource } from '../../rules/state.ts';

/** Public-only event. Never transports hands, cards, RNG or animation timing. */
export interface BuildingRollGain {
  vertexId: string;
  playerId: string;
  resource: Resource;
  count: number;
  kind: 'settlement' | 'city' | 'ship';
}
export interface RollPresentation {
  dice: readonly [number, number];
  hexIds: string[];
  gains: BuildingRollGain[];
}

type PublicBoard = Pick<GameState, 'board' | 'buildings' | 'bank'> & { players: readonly { id: string }[] };

/** Mirror the authoritative resource rules, including robber and bank shortages,
 * then distribute the publicly known award over buildings for display only. */
export function describeRoll(before: PublicBoard, dice: readonly [number, number],
  after?: {turn:number;mode?:GameState['mode']|null;harbor?:GameState['harbor']|null;catchUpReward?:GameState['catchUpReward']|null}): RollPresentation {
  const [first, second] = dice;
  if (![first, second].every(n => Number.isInteger(n) && n >= 1 && n <= 6)) throw new Error('Invalid public dice result.');
  const total = first + second;
  const catchUp=after?.catchUpReward?.turn===after?.turn ? after?.catchUpReward:null;
  const appendCatchUp=(gains:BuildingRollGain[])=>{
    if(!catchUp)return;
    const home=Object.entries(before.buildings).find(([,building])=>building.playerId===catchUp.playerId);
    if(!home)return;
    for(const resource of RESOURCES){
      const count=catchUp.gains[resource]??0;if(!count)continue;
      const [vertexId,building]=home;
      const existing=gains.find(g=>g.vertexId===vertexId&&g.playerId===catchUp.playerId&&g.resource===resource);
      if(existing)existing.count+=count;
      else gains.push({vertexId,playerId:catchUp.playerId,kind:building.kind,resource,count});
    }
  };
  if (total === 7) {
    // Harbor gives each teammate public random bank resources on a seven,
    // without hex production. Display the actual awarded resource above their
    // own home; do not infer it from private inventory.
    const reward=after?.mode==='harbor-coop'&&(after.harbor?.version===2||after.harbor?.version===3)&&after.harbor.sevenReward?.turn===after.turn
      ? after.harbor.sevenReward : null;
    const gains:BuildingRollGain[]=[];
    if(reward) for(const player of before.players){
      const home=Object.entries(before.buildings).find(([,building])=>building.playerId===player.id);
      if(!home)continue;
      const [vertexId,building]=home;
      for(const resource of RESOURCES){
        const count=reward.gains[player.id]?.[resource]??0;
        if(count>0)gains.push({vertexId,playerId:player.id,kind:building.kind,resource,count});
      }
    }
    appendCatchUp(gains);
    return {dice:[first,second],hexIds:[],gains};
  }

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
  const gains=[...awards.values()];
  appendCatchUp(gains);
  return { dice: [first, second], hexIds: hexes.map(hex => hex.id), gains };
}

export function isNewRoll(before: { dice: readonly [number, number] | null; turn: number } | null,
                         after: { dice: readonly [number, number] | null; turn: number }): boolean {
  return !!before && before.dice === null && after.dice !== null && after.turn === before.turn;
}
