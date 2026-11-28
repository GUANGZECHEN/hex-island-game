import { createIslandBoard } from '../board/geometry.ts';
import { applySetupCommand, type GameState } from './state.ts';
import { applyTurnCommand } from './turn.ts';
import { applyBuildCommand } from './build.ts';
import { applyHarborCommand } from './harbor.ts';
import { applyEconomyCommand } from './economy.ts';
export { bankTradeRate } from './economy.ts';

export type TargetMode = 'settlement'|'road'|'city'|'robber'|'pirate'|'station'|'ship';

/** Compute legal board targets with the same deterministic reducers used by gameplay. */
export function legalTargetIds(state:GameState,playerId:string,mode:TargetMode):string[]{
  if(state.players[state.currentSeat]?.id!==playerId)return [];
  const board=createIslandBoard(state.board.layout, state.board.version);
  const ids=mode==='pirate'?state.board.ports.map(port=>port.edgeId):mode==='road'?board.edges.map(edge=>edge.id):mode==='robber'?board.hexes.map(hex=>hex.id):board.vertices.map(vertex=>vertex.id);
  return ids.filter(id=>{
    try{
      if(mode==='settlement'){
        if(state.phase==='setup-settlement')applySetupCommand(state,{type:'place-settlement',playerId,vertexId:id});
        else applyBuildCommand(state,{type:'build-settlement',playerId,vertexId:id});
      }else if(mode==='station'){
        applyHarborCommand(state,{type:'harbor-build-station',playerId,vertexId:id});
      }else if(mode==='ship'){
        applyBuildCommand(state,{type:'build-ship',playerId,vertexId:id});
      }else if(mode==='city'){
        if(state.phase==='setup-city')applySetupCommand(state,{type:'place-city',playerId,vertexId:id});
        else applyBuildCommand(state,{type:'build-city',playerId,vertexId:id});
      }else if(mode==='road'){
        if(state.phase==='setup-road')applySetupCommand(state,{type:'place-road',playerId,edgeId:id});
        else if(state.phase==='free-road')applyEconomyCommand(state,{type:'free-road',playerId,edgeId:id});
        else applyBuildCommand(state,{type:'build-road',playerId,edgeId:id});
      }else if(mode==='pirate'){
        applyTurnCommand(state,{type:'move-pirate',playerId,edgeId:id});
      }else{
        applyTurnCommand(state,{type:'move-robber',playerId,hexId:id});
      }
      return true;
    }catch{return false;}
  });
}

