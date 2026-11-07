import { createIslandBoard } from '../board/geometry.ts';
import { applySetupCommand, type GameState } from '../rules/state.ts';
import { applyTurnCommand } from '../rules/turn.ts';
import { applyBuildCommand } from '../rules/build.ts';
import { applyEconomyCommand } from '../rules/economy.ts';

export type TargetMode = 'settlement'|'road'|'city'|'robber';

/** Compute legal board targets locally with the same reducers used by the rules engine. */
export function legalTargetIds(state:GameState,playerId:string,mode:TargetMode):string[]{
  if(state.players[state.currentSeat]?.id!==playerId)return [];
  const board=createIslandBoard();
  const ids=mode==='road'?board.edges.map(edge=>edge.id):mode==='robber'?board.hexes.map(hex=>hex.id):board.vertices.map(vertex=>vertex.id);
  return ids.filter(id=>{
    try{
      if(mode==='settlement'){
        if(state.phase==='setup-settlement')applySetupCommand(state,{type:'place-settlement',playerId,vertexId:id});
        else applyBuildCommand(state,{type:'build-settlement',playerId,vertexId:id});
      }else if(mode==='city'){
        applyBuildCommand(state,{type:'build-city',playerId,vertexId:id});
      }else if(mode==='road'){
        if(state.phase==='setup-road')applySetupCommand(state,{type:'place-road',playerId,edgeId:id});
        else if(state.phase==='free-road')applyEconomyCommand(state,{type:'free-road',playerId,edgeId:id});
        else applyBuildCommand(state,{type:'build-road',playerId,edgeId:id});
      }else{
        applyTurnCommand(state,{type:'move-robber',playerId,hexId:id});
      }
      return true;
    }catch{return false;}
  });
}
