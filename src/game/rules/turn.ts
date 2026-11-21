import { createIslandBoard } from '../board/geometry.ts';
import { drawIndex, secureIndex, publicVictoryPoints, RESOURCES, type GameState, type Hand } from './state.ts';

import { advanceHarbor, isHarbor } from './harbor.ts';
import { usesTradeStations } from './trade-stations.ts';
import { awardHarborSeven } from './harbor-seven.ts';

export type TurnCommand =
  | { type: 'roll'; playerId: string }
  | { type: 'discard'; playerId: string; cards: Hand }
  | { type: 'move-robber'; playerId: string; hexId: string }
  | { type: 'steal'; playerId: string; victimId: string }
  | { type: 'end-turn'; playerId: string };
const size = (hand: Hand) => RESOURCES.reduce((sum, resource) => sum + hand[resource], 0);

/** Public dice yields: identical resource rules for the reducer and the player-facing announcement.
 * Depends only on the visible board, bank stock, and dice; private hands are never inspected.
 */
export function calculateDiceProduction(
 state: Pick<GameState,'board'|'buildings'|'bank'> & {players:readonly {id:string}[]},total:number,
): Record<string,Hand> {
 const gains:Record<string,Hand>=Object.fromEntries(state.players.map(player=>[player.id,{lumber:0,brick:0,wool:0,grain:0,ore:0} as Hand]));
 if(total===7)return gains;
 const geometry=createIslandBoard(state.board.layout);
 for(const resource of RESOURCES){
  const owes=new Map<string,number>();
  for(const hex of geometry.hexes){
   const setup=state.board.hexes.find(item=>item.hexId===hex.id)!;
   if(setup.resource!==resource||setup.token!==total||state.board.robberHexId===hex.id)continue;
   for(const vertex of hex.vertexIds){
    const building=state.buildings[vertex];
    if(building)owes.set(building.playerId,(owes.get(building.playerId)??0)+(building.kind==='city'?2:1));
   }
  }
  const totalOwed=[...owes.values()].reduce((a,b)=>a+b,0);
  if(owes.size>1&&totalOwed>state.bank[resource])continue;
  let available=state.bank[resource];
  for(const [id,amount] of owes){
   if(!gains[id])throw new Error('Invalid building owner.');
   const quantity=Math.min(amount,available);
   gains[id][resource]+=quantity;
   available-=quantity;
  }
 }
 return gains;
}
/** Announce a roll using public state only. Random seven rewards come from the
 * authoritative result and must never be re-rolled or inferred from hidden hands. */
export function diceProductionSummary(
 before:Parameters<typeof calculateDiceProduction>[0],
 after:Pick<GameState,'dice'|'turn'|'mode'> & {harbor?:GameState['harbor']|null},
):Record<string,Hand> {
 const total=after.dice?after.dice[0]+after.dice[1]:0;
 const reward=after.harbor?.sevenReward;
 if(total===7&&after.mode==='harbor-coop'&&(after.harbor?.version===2||after.harbor?.version===3)&&reward?.turn===after.turn){
  return structuredClone(reward.gains);
 }
 return calculateDiceProduction(before,total);
}
/** Draw distinct stocked resources for a lagging player after their roll.
 * Host RNG remains authoritative; the public reward metadata makes UI/recovery exact. */
export function awardCatchUp(state: GameState, secureRandom?: () => number): void {
  delete state.catchUpReward;
  if(state.mode==='harbor-coop'||!state.rules?.catchUp)return;
  const active=state.players[state.currentSeat];
  const leader=Math.max(...state.players.map(player=>publicVictoryPoints(state,player.id)));
  if(publicVictoryPoints(state,active.id)>3||leader<5)return;
  const count=leader>=6?2:1;
  const gains:Hand={lumber:0,brick:0,wool:0,grain:0,ore:0};
  const remaining=RESOURCES.filter(resource=>state.bank[resource]>0);
  for(let i=0;i<count&&remaining.length;i++){
    const draw=secureRandom?secureIndex(secureRandom,remaining.length):drawIndex(state.randomState,remaining.length);
    state.randomState=draw.state??state.randomState;
    const [resource]=remaining.splice(draw.index,1);
    state.bank[resource]--;active.hand[resource]++;gains[resource]++;
  }
  if(RESOURCES.some(resource=>gains[resource]))state.catchUpReward={turn:state.turn,playerId:active.id,gains};
}
/** Apply exactly the publicly computable awards, preserving single-recipient shortage behavior. */
export function produce(state:GameState,total:number):void {
 const gains=calculateDiceProduction(state,total);
 for(const player of state.players){
  for(const resource of RESOURCES){
   const quantity=gains[player.id][resource];
   state.bank[resource]-=quantity;
   player.hand[resource]+=quantity;
  }
 }
}
export function applyTurnCommand(original: GameState, command: TurnCommand, secureRandom?: () => number): GameState {
  const state = structuredClone(original), active = state.players[state.currentSeat];
  if(state.mode==='harbor-coop'&&state.harbor?.version===3&&['discard','move-robber','steal'].includes(command?.type))throw new Error('Discard and robber actions are unavailable in Harbor v3.');
  if (!command || (!state.discards[command.playerId] && active.id !== command.playerId)) throw new Error('Not an authorized player.');
  if (command.type === 'roll' && state.phase === 'roll' && active.id === command.playerId) {
    const first = secureRandom ? secureIndex(secureRandom, 6) : drawIndex(state.randomState, 6), second = secureRandom ? secureIndex(secureRandom, 6) : drawIndex(first.state!, 6);
    state.randomState = second.state ?? state.randomState; state.dice = [first.index + 1, second.index + 1];
    if(state.harbor)delete state.harbor.sevenReward;
    if (state.dice[0] + state.dice[1] === 7) {
      if(usesTradeStations(state)){
        // Cooperative seven only grants resources: no discard, robber move or theft.
        state.discards={};state.victims=[];state.resumePhase=null;
        awardHarborSeven(state,secureRandom);state.phase='action';
      }else{
        state.discards = Object.fromEntries(state.players.filter(player => size(player.hand) > 7).map(player => [player.id, Math.floor(size(player.hand) / 2)]));
        state.phase = Object.keys(state.discards).length ? 'discard' : 'robber';
      }
    } else { produce(state, state.dice[0] + state.dice[1]); state.phase = 'action'; }
    awardCatchUp(state,secureRandom);
  } else if (command.type === 'discard' && state.phase === 'discard') {
    const required = state.discards[command.playerId], player = state.players.find(p => p.id === command.playerId);
    if (!required || !player || !command.cards || Object.keys(command.cards).sort().join(',') !== [...RESOURCES].sort().join(',') || RESOURCES.some(r => !Number.isInteger(command.cards[r]) || command.cards[r] < 0 || command.cards[r] > player.hand[r]) || size(command.cards) !== required) throw new Error('Invalid discard.');
    for (const r of RESOURCES) { player.hand[r] -= command.cards[r]; state.bank[r] += command.cards[r]; }
    delete state.discards[player.id]; if (!Object.keys(state.discards).length) state.phase = 'robber';
  } else if (command.type === 'move-robber' && state.phase === 'robber' && active.id === command.playerId) {
    const hex = createIslandBoard(state.board.layout).hexes.find(hex => hex.id === command.hexId);
    if (!hex || hex.id === state.board.robberHexId) throw new Error('Robber must move to a different hex.');
    state.board = { ...state.board, robberHexId: hex.id };
    state.victims = [...new Set(hex.vertexIds.map(id => state.buildings[id]?.playerId).filter((id): id is string => !!id && id !== active.id && size(state.players.find(p => p.id === id)!.hand) > 0))];
    if(isHarbor(state))state.victims=[];
    state.phase = state.victims.length ? 'steal' : state.resumePhase ?? 'action'; if (!state.victims.length) state.resumePhase = null;
  } else if (command.type === 'steal' && state.phase === 'steal' && active.id === command.playerId) {
    if (!state.victims.includes(command.victimId)) throw new Error('Invalid victim.');
    const victim = state.players.find(player => player.id === command.victimId)!;
    const draw = secureRandom ? secureIndex(secureRandom, size(victim.hand)) : drawIndex(state.randomState, size(victim.hand)); state.randomState = draw.state ?? state.randomState;
    let index = draw.index;
    for (const resource of RESOURCES) { if (index < victim.hand[resource]) { victim.hand[resource]--; active.hand[resource]++; break; } index -= victim.hand[resource]; }
    state.victims = []; state.phase = state.resumePhase ?? 'action'; state.resumePhase = null;
  } else if (command.type === 'end-turn' && state.phase === 'action' && active.id === command.playerId) {
    if(state.harbor)delete state.harbor.sevenReward;
    delete state.catchUpReward;
    state.currentSeat = (state.currentSeat + 1) % state.players.length; state.turn++; state.dice = null; state.playedDevelopment = false; state.offer = null; state.phase = 'roll'; advanceHarbor(state);
  } else throw new Error('Command is not allowed in this phase.');
  return state;
}
