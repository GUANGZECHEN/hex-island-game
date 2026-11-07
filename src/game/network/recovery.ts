import type { GameState } from '../rules/state.ts';

export interface AuthorityRecovery {
  version: 1;
  gameId: string;
  revision: number;
  state: GameState;
}

export interface RecoverySeat {
  id: string;
  token: string;
}

export interface SessionRecovery {
  version: 1;
  authority: AuthorityRecovery;
  seats: RecoverySeat[];
  qaTwoPlayers: boolean;
}

const idPattern=/^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;

export function recoveryRound(state:GameState):number {
  if(state.turn<=0)return 0;
  return Math.floor((state.turn-1)/state.players.length)+1;
}

export function parseSessionRecovery(value:unknown):SessionRecovery {
  const x=value as Partial<SessionRecovery>|null;
  if(!x||x.version!==1||typeof x.qaTwoPlayers!=='boolean'||!x.authority||!Array.isArray(x.seats))throw new Error('Invalid saved game.');
  const authority=x.authority as Partial<AuthorityRecovery>;
  if(authority.version!==1||typeof authority.gameId!=='string'||!idPattern.test(authority.gameId)||!Number.isSafeInteger(authority.revision)||Number(authority.revision)<0||!authority.state||authority.state.version!==1)throw new Error('Invalid saved game.');
  const state=authority.state as GameState;
  const validCount=x.qaTwoPlayers?state.players.length===2:state.players.length>=3&&state.players.length<=4;
  if(!validCount||x.seats.length!==state.players.length)throw new Error('Saved game player count is invalid.');
  for(let i=0;i<x.seats.length;i++){
    const seat=x.seats[i] as RecoverySeat;
    if(!seat||seat.id!==state.players[i].id||typeof seat.token!=='string')throw new Error('Saved game seat mapping is invalid.');
    if(i===0){if(seat.token!=='')throw new Error('Saved host seat is invalid.');}
    else if(!tokenPattern.test(seat.token))throw new Error('Saved guest seat is invalid.');
  }
  return structuredClone(x as SessionRecovery);
}
