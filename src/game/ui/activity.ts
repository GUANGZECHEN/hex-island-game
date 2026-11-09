export interface PublicActivityPlayer {
  id: string;
  name?: string;
  resources: number;
  developmentCards: number;
}

export interface PublicActivityState {
  players: readonly PublicActivityPlayer[];
  currentSeat: number;
  turn: number;
  phase: string;
  dice: readonly [number, number] | null;
  victims: readonly string[];
  board: { robberHexId: string };
  roads: Readonly<Record<string,string>>;
  buildings: Readonly<Record<string,{playerId:string;kind:'settlement'|'city'}>>;
  playedCards: readonly string[];
  bank: Readonly<Record<string,number>>;
  deckCount: number;
  offer: {proposer:string;targets:readonly string[];giveCount:number;receiveCount:number} | null;
}

const activePlayer=(state:PublicActivityState)=>state.players[state.currentSeat];
const activeId=(state:PublicActivityState)=>activePlayer(state)?.id ?? 'Unknown player';
const label=(state:PublicActivityState,id:string)=>state.players.find(player=>player.id===id)?.name ?? id;
const resources=(state:PublicActivityState,id:string)=>state.players.find(player=>player.id===id)?.resources ?? 0;
const developmentCards=(state:PublicActivityState,id:string)=>state.players.find(player=>player.id===id)?.developmentCards ?? 0;
const bankSize=(state:PublicActivityState)=>Object.values(state.bank).reduce((sum,count)=>sum+count,0);

export function turnAnnouncement(state:PublicActivityState):string {
  const id=activeId(state);return state.phase==='finished' ? 'Game finished.' : `It’s ${label(state,id)}’s turn.`;
}

export function derivePublicActivity(previous:PublicActivityState|null,next:PublicActivityState):string|null {
  if(!previous)return null;
  const actorId=activeId(previous),actor=label(previous,actorId);

  if(next.dice && (!previous.dice || previous.dice[0]!==next.dice[0] || previous.dice[1]!==next.dice[1])){
    const [first,second]=next.dice;
    return `${actor} rolled dice: ${first} + ${second} = ${first+second}.`;
  }

  if(previous.board.robberHexId!==next.board.robberHexId){
    return `${actor} moved the robber.`;
  }

  if(previous.phase==='steal' && next.phase!=='steal'){
    const victim=previous.victims.find(id=>resources(next,id)===resources(previous,id)-1);
    return victim ? `${actor} stole 1 card from ${label(previous,victim)}.` : `${actor} stole 1 card.`;
  }

  const previousRoads=new Set(Object.keys(previous.roads));
  const newRoad=Object.entries(next.roads).find(([edgeId,owner])=>!previousRoads.has(edgeId)&&owner===actorId);
  if(newRoad)return `${actor} built a road.`;

  for(const [vertexId,building] of Object.entries(next.buildings)){
    const before=previous.buildings[vertexId];
    if(!before && building.playerId===actorId)return `${actor} built a settlement.`;
    if(before?.playerId===actorId&&before.kind==='settlement'&&building.playerId===actorId&&building.kind==='city')return `${actor} upgraded a settlement to a city.`;
  }

  if(previous.phase==='action'&&next.phase==='action'&&next.deckCount===previous.deckCount-1&&developmentCards(next,actorId)===developmentCards(previous,actorId)+1){
    return `${actor} bought a development card.`;
  }

  if(next.playedCards.length>previous.playedCards.length){
    const card=next.playedCards.at(-1);
    if(card)return `${actor} played ${card.replaceAll('-',' ')}.`;
  }

  if(previous.phase==='action'&&next.phase==='action'&&previous.offer&&!next.offer){
    const accepter=previous.offer.targets[0];
    if(accepter)return `${label(previous,previous.offer.proposer)} traded ${previous.offer.giveCount} card${previous.offer.giveCount===1?'':'s'} for ${previous.offer.receiveCount} card${previous.offer.receiveCount===1?'':'s'} with ${label(previous,accepter)}.`;
  }

  if(previous.phase==='action'&&next.phase==='action'){
    const bankGain=bankSize(next)-bankSize(previous);
    const actorLoss=resources(previous,actorId)-resources(next,actorId);
    if(bankGain===actorLoss && (bankGain===1||bankGain===2||bankGain===3)){
      const rate=bankGain+1;
      if(rate===2)return `${actor} traded 2:1 at a resource port.`;
      if(rate===3)return `${actor} traded 3:1 at a generic port.`;
      return `${actor} traded 4:1 with the bank.`;
    }
  }

  if(previous.phase==='action'&&next.phase==='roll'&&previous.currentSeat!==next.currentSeat){
    return `${actor} ended the turn.`;
  }

  return null;
}
