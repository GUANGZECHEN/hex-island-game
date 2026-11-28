import { validateHarborState } from '../rules/harbor.ts';
import { robberVictims } from '../rules/turn.ts';
import { validateOptionalRules } from '../rules/optional-rules.ts';
import { RESOURCES, type GameState, type Hand } from '../rules/state.ts';
import { boardPlayerRange, isBoardLayout, type BoardLayout } from '../board/geometry.ts';
import { generateBoardSetup, GENERATOR_VERSION } from '../board/setup.ts';

export interface AuthorityRecovery {
  version: 1;
  gameId: string;
  revision: number;
  state: GameState;
  pendingDiscards?: Record<string,Hand>;
  clock?: { paused:boolean; remaining:Record<string,number> };
}

export interface RecoverySeat {
  id: string;
  token: string;
  name?: string;
}

export interface SessionRecovery {
  version: 1;
  authority: AuthorityRecovery;
  seats: RecoverySeat[];
  qaTwoPlayers: boolean;
  boardLayout: BoardLayout;
  /** Optional ship preference to restore if the host later switches away from Twin Capes. */
  mainlandShips?: boolean;
}

const idPattern=/^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;

export function recoveryRound(state:GameState):number {
  if(state.turn<=0)return 0;
  return Math.floor((state.turn-1)/state.players.length)+1;
}

/** Seed and generator version fix the map; the robber or legacy pirate position is mutable. */
export function validateSavedBoard(state:GameState, declared?:unknown):BoardLayout {
  const board=state.board,layout=declared??board?.layout??'standard';
  if(!board||!isBoardLayout(layout)||(board.layout!==undefined&&board.layout!==layout))throw new Error('Saved game board layout is invalid.');
  const {min,max}=boardPlayerRange(layout);
  if(!Array.isArray(state.players)||state.players.length<min||state.players.length>max)throw new Error('Saved game player count is invalid.');
  if(layout!=='twin-capes'){
    if(state.phase==='pirate'||board.piratePortEdgeId!==undefined)throw new Error('Pirate data is only valid on Twin Capes.');
    return layout;
  }
  if(board.layout!==layout||state.mode==='harbor-coop'||state.rules?.ships!==true||!Array.isArray(state.victims))
    throw new Error('Invalid saved Twin Capes rules.');
  const expected=generateBoardSetup(board.seed,layout,board.version);
  const sameHexes=Array.isArray(board.hexes)&&board.hexes.length===expected.hexes.length&&expected.hexes.every((hex,index)=>{
    const saved=board.hexes[index];
    return saved?.hexId===hex.hexId&&saved.terrain===hex.terrain&&saved.resource===hex.resource&&saved.token===hex.token;
  });
  const samePorts=Array.isArray(board.ports)&&board.ports.length===expected.ports.length&&expected.ports.every((port,index)=>{
    const saved=board.ports[index];
    return saved?.edgeId===port.edgeId&&saved.type===port.type&&Array.isArray(saved.vertexIds)&&saved.vertexIds.length===2&&
      saved.vertexIds[0]===port.vertexIds[0]&&saved.vertexIds[1]===port.vertexIds[1];
  });
  if(board.version!==expected.version||!sameHexes||!samePorts)throw new Error('Invalid saved Twin Capes map.');
  if(board.version===GENERATOR_VERSION){
    if(board.robberHexId!==''||state.phase==='robber'||state.phase==='steal'||state.victims.length||
       !expected.ports.some(port=>port.edgeId===board.piratePortEdgeId))throw new Error('Invalid saved legacy pirate harbor.');
  }else{
    if(board.piratePortEdgeId!==undefined||state.phase==='pirate'||!expected.hexes.some(hex=>hex.hexId===board.robberHexId))
      throw new Error('Invalid saved Twin Capes robber position.');
    const eligible=state.phase==='steal'?robberVictims(state,board.robberHexId):[];
    if((state.phase==='steal'&&!eligible.length)||eligible.length!==state.victims.length||eligible.some(id=>!state.victims.includes(id)))
      throw new Error('Invalid saved Twin Capes robber victims.');
  }
  return layout;
}

/** A reconnect may replay aggregate gains, but never another player's hand or resource types. */
export function validateSavedRollPayout(state:GameState):void {
  const payout=state.lastRollPayout;
  if(payout===undefined)return;
  const ids=state.players.map(p=>p.id);
  if(!payout||Object.keys(payout).sort().join(',')!=='dice,gains,playerId,turn'||
     !Number.isSafeInteger(payout.turn)||payout.turn<0||payout.turn>state.turn||!ids.includes(payout.playerId)||
     !Array.isArray(payout.dice)||payout.dice.length!==2||payout.dice.some(n=>!Number.isInteger(n)||n<1||n>6)||
     !payout.gains||typeof payout.gains!=='object'||Array.isArray(payout.gains)||Object.keys(payout.gains).length!==ids.length||
     ids.some(id=>!Object.hasOwn(payout.gains,id)||!Number.isSafeInteger(payout.gains[id])||payout.gains[id]<0))
    throw new Error('Invalid saved roll payout.');
}

export function parseSessionRecovery(value:unknown):SessionRecovery {
  const x=value as Partial<SessionRecovery>|null;
  if(!x||x.version!==1||typeof x.qaTwoPlayers!=='boolean'||!x.authority||!Array.isArray(x.seats))throw new Error('Invalid saved game.');
  const authority=x.authority as Partial<AuthorityRecovery>;
  if(authority.version!==1||typeof authority.gameId!=='string'||!idPattern.test(authority.gameId)||!Number.isSafeInteger(authority.revision)||Number(authority.revision)<0||!authority.state||authority.state.version!==1)throw new Error('Invalid saved game.');
  const state=authority.state as GameState;validateHarborState(state);
  const boardLayout=validateSavedBoard(state,x.boardLayout);
  validateSavedRollPayout(state);
  if(x.mainlandShips!==undefined&&(boardLayout!=='twin-capes'||typeof x.mainlandShips!=='boolean'))throw new Error('Invalid saved board ship preference.');
  const rules=validateOptionalRules(state.rules);
  if(state.mode==='harbor-coop'&&(rules.catchUp||rules.ships))throw new Error('Optional Classic rules conflict with Harbor mode.');
  if(Object.values(state.buildings).some(b=>b.kind==='ship')&&!rules.ships)throw new Error('Saved ships rule is disabled.');
  const reward=state.catchUpReward;
  if(reward){
    const gains=reward.gains;
    if(!rules.catchUp||!Number.isSafeInteger(reward.turn)||reward.turn!==state.turn||
       state.players[state.currentSeat]?.id!==reward.playerId||
       !Array.isArray(state.dice)||state.dice.length!==2||state.dice.some(d=>!Number.isInteger(d)||d<1||d>6)||
       !['discard','robber','pirate','steal','action','free-road','finished'].includes(state.phase)||
       !gains||typeof gains!=='object'||Array.isArray(gains)||
       Object.keys(gains).sort().join(',')!==[...RESOURCES].sort().join(',')||
       RESOURCES.some(r=>!Number.isSafeInteger(gains[r])||gains[r]<0||gains[r]>1)||
       RESOURCES.reduce((sum,r)=>sum+gains[r],0)<1||RESOURCES.reduce((sum,r)=>sum+gains[r],0)>2)
      throw new Error('Invalid saved catch-up award.');
  }
  if(x.seats.length!==state.players.length)throw new Error('Saved game player count is invalid.');
  for(let i=0;i<x.seats.length;i++){
    const seat=x.seats[i] as RecoverySeat;
    if(!seat||seat.id!==state.players[i].id||typeof seat.token!=='string')throw new Error('Saved game seat mapping is invalid.');
    if(seat.name!==undefined&&(typeof seat.name!=='string'||seat.name.trim().length<1||seat.name.trim().length>20))throw new Error('Saved player nickname is invalid.');
    if(i===0){if(seat.token!=='')throw new Error('Saved host seat is invalid.');}
    else if(!tokenPattern.test(seat.token))throw new Error('Saved guest seat is invalid.');
  }
  const result=structuredClone(x as SessionRecovery);result.boardLayout=boardLayout;result.authority.state.board.layout=boardLayout;return result;
}
