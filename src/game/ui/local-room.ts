import type { BoardLayout } from '../board/geometry.ts';

export interface LocalRoomSettings {
 readonly seed: number;
 readonly totalPlayers: number;
 readonly botCount: number;
 readonly boardLayout: BoardLayout;
 readonly ids: readonly string[];
}

/** Validate once in the local lobby; reuse these immutable selections when restarting a round. */
export function createLocalRoomSettings(seed:number,selectedPlayers:number,botCount:number):LocalRoomSettings {
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Map seed must be between 0 and 4294967295.');
 if(!Number.isSafeInteger(selectedPlayers)||selectedPlayers<2||selectedPlayers>6)throw new Error('Choose between 2 and 6 players.');
 if(!Number.isSafeInteger(botCount)||botCount<0||botCount>5)throw new Error('Choose between 0 and 5 bots.');
 const totalPlayers=botCount>0?botCount+1:selectedPlayers;
 const boardLayout:BoardLayout=totalPlayers>=5?'expanded-5-6':'standard';
 const ids=botCount>0?['Player 1',...Array.from({length:botCount},(_,index)=>botCount===1?'Bot':`Bot ${index+1}`)]:Array.from({length:totalPlayers},(_,index)=>`Player ${index+1}`);
 return {seed,totalPlayers,botCount,boardLayout,ids};
}
