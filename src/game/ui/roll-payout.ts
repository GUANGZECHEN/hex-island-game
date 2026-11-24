import type { GameState } from '../rules/state.ts';

type RollPayout = NonNullable<GameState['lastRollPayout']>;
export type GameLogEntry = string | {rollTurn:number; text:string};

/** Public counts come from the completed authoritative roll, even after reconnect or a later action. */
export function logRollPayout(log:GameLogEntry[], receipt:RollPayout|null|undefined, players:readonly {id:string}[], name:(id:string)=>string):void {
  if(!receipt||log.some(entry=>typeof entry!=='string'&&entry.rollTurn===receipt.turn))return;
  const total=receipt.dice[0]+receipt.dice[1];
  const counts=players.map(player=>`${name(player.id)} +${receipt.gains[player.id]}`).join(', ');
  log.unshift({rollTurn:receipt.turn,text:`Turn ${receipt.turn} · Roll ${total} · ${counts}`});
}

export function ownPayoutLabel(receipt:RollPayout, id:string):string {
  const count=receipt.gains[id];
  return `Roll ${receipt.dice[0]+receipt.dice[1]} · You gained ${count} resource${count===1?'':'s'}.`;
}
