import { drawIndex, secureIndex, RESOURCES, type GameState, type Hand } from './state.ts';
import { usesTradeStations } from './trade-stations.ts';

/** One authoritative roll's public awards, not either player's private inventory. */
export interface SevenReward { turn:number; gains:Record<string,Hand> }
const emptyHand=():Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0});

/** Called only inside a validated roll transition, never during rendering/recovery.
 * Draw resource TYPES uniformly from bank types still in stock. Each player can
 * receive the same type. In the exceptional one-card shortage, the current roller
 * receives first; this rotates with turns rather than favoring a fixed player seat.
 */
export function awardHarborSeven(state:GameState,secureRandom?:()=>number):void {
 if(!usesTradeStations(state)||state.players.length!==2)throw new Error('Harbor v2 requires two partners.');
 const gains:Record<string,Hand>=Object.fromEntries(state.players.map(p=>[p.id,emptyHand()]));
 for(let offset=0;offset<state.players.length;offset++){
  const player=state.players[(state.currentSeat+offset)%state.players.length];
  const stocked=RESOURCES.filter(resource=>state.bank[resource]>0);
  if(!stocked.length)break;
  const draw=secureRandom?secureIndex(secureRandom,stocked.length):drawIndex(state.randomState,stocked.length);
  state.randomState=draw.state??state.randomState;
  const resource=stocked[draw.index];
  state.bank[resource]--;player.hand[resource]++;gains[player.id][resource]++;
 }
 state.harbor!.sevenReward={turn:state.turn,gains};
}

/** Validate optional public metadata in saved games; old saves may omit it. */
export function validateSevenReward(state:GameState):void {
 const reward=state.harbor?.sevenReward;if(reward===undefined)return;
 if(!usesTradeStations(state)||!reward||typeof reward!=='object'||Array.isArray(reward)||
    !Number.isSafeInteger(reward.turn)||reward.turn<1||reward.turn!==state.turn||
    !state.dice||state.dice[0]+state.dice[1]!==7||state.phase.startsWith('setup')||state.phase==='roll'||state.phase==='discard'||
    !reward.gains||typeof reward.gains!=='object'||Array.isArray(reward.gains)||
    Object.keys(reward.gains).sort().join(',')!==state.players.map(p=>p.id).sort().join(',')){
  throw new Error('Invalid saved seven reward.');
 }
 for(const player of state.players){
  const hand=reward.gains[player.id];
  if(!hand||typeof hand!=='object'||Array.isArray(hand)||
     Object.keys(hand).sort().join(',')!==[...RESOURCES].sort().join(',')||
     RESOURCES.some(r=>!Number.isSafeInteger(hand[r])||hand[r]<0)||
     RESOURCES.reduce((sum,r)=>sum+hand[r],0)>1)throw new Error('Invalid saved seven reward.');
 }
}
