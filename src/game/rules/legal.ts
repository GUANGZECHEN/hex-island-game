import { createIslandBoard } from '../board/geometry.ts';
import { applySetupCommand, type GameState, type Resource } from './state.ts';
import { applyTurnCommand } from './turn.ts';
import { applyBuildCommand } from './build.ts';
import { applyEconomyCommand } from './economy.ts';

export type TargetMode = 'settlement'|'road'|'city'|'robber';

/** Compute legal board targets with the same deterministic reducers used by gameplay. */
export function legalTargetIds(state:GameState,playerId:string,mode:TargetMode):string[]{
  if(state.players[state.currentSeat]?.id!==playerId)return [];
  const board=createIslandBoard(state.board.layout);
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

export function bankTradeRate(state:GameState,playerId:string,resource:Resource):2|3|4 {
  const owns=(kind:string)=>state.board.ports.some(port=>port.type===kind&&port.vertexIds.some(vertexId=>state.buildings[vertexId]?.playerId===playerId));
  if(owns(resource))return 2;
  if(owns('generic'))return 3;
  return 4;
}
