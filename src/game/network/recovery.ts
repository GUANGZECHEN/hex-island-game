import type { GameState } from '../rules/state.ts';
import type { BoardLayout } from '../board/geometry.ts';

export interface AuthorityRecovery {
  version: 1;
  gameId: string;
  revision: number;
  state: GameState;
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
  const boardLayout=(x.boardLayout??state.board?.layout??'standard') as BoardLayout;
  if(boardLayout!=='standard'&&boardLayout!=='expanded-5-6')throw new Error('Saved game board layout is invalid.');
  const validCount=boardLayout==='expanded-5-6'?state.players.length>=5&&state.players.length<=6:state.players.length>=2&&state.players.length<=4;
  if(!validCount||x.seats.length!==state.players.length)throw new Error('Saved game player count is invalid.');
  for(let i=0;i<x.seats.length;i++){
    const seat=x.seats[i] as RecoverySeat;
    if(!seat||seat.id!==state.players[i].id||typeof seat.token!=='string')throw new Error('Saved game seat mapping is invalid.');
    if(seat.name!==undefined&&(typeof seat.name!=='string'||seat.name.trim().length<1||seat.name.trim().length>20))throw new Error('Saved player nickname is invalid.');
    if(i===0){if(seat.token!=='')throw new Error('Saved host seat is invalid.');}
    else if(!tokenPattern.test(seat.token))throw new Error('Saved guest seat is invalid.');
  }
  const result=structuredClone(x as SessionRecovery);result.boardLayout=boardLayout;result.authority.state.board.layout=boardLayout;return result;
}
