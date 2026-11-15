import type { GameMode } from '../rules/harbor.ts';
import type { BoardLayout } from '../board/geometry.ts';

export interface LocalRoomSettings {
 readonly mode:GameMode;
 readonly seed: number;
 readonly totalPlayers: number;
 readonly botCount: number;
 readonly boardLayout: BoardLayout;
 readonly ids: readonly string[];
}

/** Validate once in the local lobby; reuse these immutable selections when restarting a round. */
export function createLocalRoomSettings(seed:number,selectedPlayers:number,botCount:number,mode:GameMode='classic'):LocalRoomSettings {
 if(mode!=='classic'&&mode!=='harbor-coop')throw new Error('Invalid game mode.');
 if(mode==='harbor-coop'&&(selectedPlayers!==2||botCount>1))throw new Error('Harbor Co-op supports two people, or one person and one bot.');
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Map seed must be between 0 and 4294967295.');
 if(!Number.isSafeInteger(selectedPlayers)||selectedPlayers<2||selectedPlayers>6)throw new Error('Choose between 2 and 6 players.');
 if(!Number.isSafeInteger(botCount)||botCount<0||botCount>5)throw new Error('Choose between 0 and 5 bots.');
 const totalPlayers=botCount>0?botCount+1:selectedPlayers;
 const boardLayout:BoardLayout=totalPlayers>=5?'expanded-5-6':'standard';
 const ids=botCount>0?['Player 1',...Array.from({length:botCount},(_,index)=>botCount===1?'Bot':`Bot ${index+1}`)]:Array.from({length:totalPlayers},(_,index)=>`Player ${index+1}`);
 return {mode,seed,totalPlayers,botCount,boardLayout,ids};
}
