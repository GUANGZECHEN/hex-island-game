import type { GameMode } from '../rules/harbor.ts';
import type { BoardLayout } from '../board/geometry.ts';
import { validateOptionalRules, type OptionalRules } from '../rules/optional-rules.ts';

export type LocalBoardChoice = 'auto' | 'twin-capes';

export interface LocalRoomSettings {
 readonly mode:GameMode;
 readonly rules:OptionalRules;
 readonly seed: number;
 readonly totalPlayers: number;
 readonly botCount: number;
 readonly boardLayout: BoardLayout;
 readonly ids: readonly string[];
 readonly humanId: string | null;
 readonly botIds: readonly string[];
}

/** Validate once in the local lobby; reuse these immutable selections when restarting a round. */
export function createLocalRoomSettings(seed:number,selectedPlayers:number,botCount:number,mode:GameMode='classic',rules?:OptionalRules,boardChoice:LocalBoardChoice='auto'):LocalRoomSettings {
 if(mode!=='classic'&&mode!=='harbor-coop')throw new Error('Invalid game mode.');
 if(boardChoice!=='auto'&&boardChoice!=='twin-capes')throw new Error('Invalid local board.');
 if(boardChoice==='twin-capes'&&mode!=='classic')throw new Error('Twin Capes requires Classic mode.');
 const selectedRules=validateOptionalRules(rules);
 if(mode==='harbor-coop'&&(selectedRules.catchUp||selectedRules.ships))throw new Error('Optional Classic rules are not available in Harbor Co-op.');
 if(mode==='harbor-coop'&&(selectedPlayers!==2||botCount>1))throw new Error('Harbor Co-op supports two people, or one person and one bot.');
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Map seed must be between 0 and 4294967295.');
 if(!Number.isSafeInteger(selectedPlayers)||selectedPlayers<2||selectedPlayers>6)throw new Error('Choose between 2 and 6 players.');
 if(!Number.isSafeInteger(botCount)||botCount<0||botCount>5)throw new Error('Choose between 0 and 5 bots.');
 const totalPlayers=botCount>0?botCount+1:selectedPlayers;
 const boardLayout:BoardLayout=boardChoice==='twin-capes'?'twin-capes':totalPlayers>=5?'expanded-5-6':'standard';
 const humanId=botCount>0?'Player 1':null;
 const botIds=Array.from({length:botCount},(_,index)=>botCount===1?'Bot':`Bot ${index+1}`);
 const ids=humanId?(mode==='harbor-coop'?[...botIds,humanId]:[humanId,...botIds]):Array.from({length:totalPlayers},(_,index)=>`Player ${index+1}`);
 return {mode,rules:boardLayout==='twin-capes'?{...selectedRules,ships:true}:selectedRules,seed,totalPlayers,botCount,boardLayout,ids,humanId,botIds};
}
