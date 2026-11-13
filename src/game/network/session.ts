import { createGame } from '../rules/state.ts';
import type { BoardLayout } from '../board/geometry.ts';
import { HostAuthority } from './authority.ts';
import { parseSessionRecovery, recoveryRound, type SessionRecovery } from './recovery.ts';

export interface LobbySeat { id:string; name:string; connected:boolean; ready:boolean }
interface Seat extends LobbySeat { peer:string | null; token:string }
const cleanName=(value:unknown,fallback:string)=>{if(typeof value!=='string')return fallback;const name=value.replace(/\s+/g,' ').trim();return name.length>=1&&name.length<=20?name:fallback;};
type Send = (peer:string, message:string)=>void;

/** Host-only session. Credentials must be generated with cryptographically secure randomness. */
export class HostSession {
 private seats:Seat[]; private spectators=new Set<string>(); private authority:HostAuthority|null=null; private gameId=''; private recovering=false;
 constructor(privateSend:Send, privatePublish:(value:unknown)=>void, privateToken:()=>string, privateRandom:()=>number, options: { qaTwoPlayers?: boolean; boardLayout?: BoardLayout; mapSeed?:number } = {}) {
  this.send=privateSend;this.publish=privatePublish;this.token=privateToken;this.random=privateRandom;this.qaTwoPlayers=options.qaTwoPlayers === true;this.boardLayout=options.boardLayout??'standard';this.mapSeed=options.mapSeed??1;
  this.seats=[{id:'Player 1',name:'Player 1',connected:true,ready:false,peer:null,token:''}];
 }
 private qaTwoPlayers:boolean; private boardLayout:BoardLayout; private mapSeed:number; private send:Send; private publish:(value:unknown)=>void; private token:()=>string; private random:()=>number;

 static fromRecovery(privateSend:Send,privatePublish:(value:unknown)=>void,privateToken:()=>string,privateRandom:()=>number,value:unknown):HostSession {
  const recovery=parseSessionRecovery(value);
  const host=new HostSession(privateSend,privatePublish,privateToken,privateRandom,{qaTwoPlayers:recovery.qaTwoPlayers,boardLayout:recovery.boardLayout,mapSeed:recovery.authority.state.board.seed});
  host.restoreRecovery(recovery,true);
  host.announce();
  return host;
 }

 lobby():LobbySeat[]{return this.seats.map(({id,name,connected,ready})=>({id,name,connected,ready}));}
 spectatorCount():number{return this.spectators.size;}
 isRecovering():boolean{return this.recovering;}
 allSeatsConnected():boolean{return this.seats.length>0&&this.seats.every(seat=>seat.connected);}
 recovery():SessionRecovery {
  if(!this.authority)throw new Error('Game not started.');
  return {version:1,authority:this.authority.checkpoint(),seats:this.seats.map(({id,token,name})=>({id,token,name})),qaTwoPlayers:this.qaTwoPlayers,boardLayout:this.boardLayout};
 }
 private output(peer:string,type:string,data:unknown){this.send(peer,JSON.stringify({protocol:1,type,data}));}
 private capacity(){return this.boardLayout==='expanded-5-6'?6:4;}
 private availableSeatId(){for(let i=2;i<=this.capacity();i++)if(!this.seats.some(seat=>seat.id===`Player ${i}`))return `Player ${i}`;return null;}
 private claimSeat(peer:string,name:unknown):Seat|null{
  const vacant=this.seats.find((seat,index)=>index>0&&!seat.connected);
  if(!vacant&&this.seats.length>=this.capacity())return null;
  const credential=this.token();
  if(!/^[A-Za-z0-9_-]{43}$/.test(credential)||this.seats.some(seat=>seat.token===credential))throw new Error('Invalid seat credential.');
  if(vacant){vacant.token=credential;vacant.ready=false;vacant.name=cleanName(name,vacant.id);vacant.peer=peer;vacant.connected=true;return vacant;}
  const id=this.availableSeatId();if(!id)return null;
  const seat={id,name:cleanName(name,id),connected:true,ready:false,peer,token:credential};
  this.seats.push(seat);return seat;
 }
 private announce(){
  const lobby={seats:this.lobby(),qaTwoPlayers:this.qaTwoPlayers,boardLayout:this.boardLayout,mapSeed:this.mapSeed,started:!!this.authority,recovering:this.recovering,spectators:this.spectators.size};
  this.publish({type:'lobby',lobby});
  for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'lobby',lobby);
  for(const peer of this.spectators)this.output(peer,'lobby',lobby);
 }
 private emitCheckpoint(replace=false){if(!this.authority)return;const data=this.recovery();this.publish({type:'checkpoint',data,revision:data.authority.revision,round:recoveryRound(data.authority.state),replace});}
 private restoreRecovery(value:SessionRecovery,paused:boolean){
  const currentPeers=new Map(this.seats.map(seat=>[seat.id,seat.peer]));
  this.qaTwoPlayers=value.qaTwoPlayers;
  this.boardLayout=value.boardLayout;
  this.mapSeed=value.authority.state.board.seed;
  this.gameId=value.authority.gameId;
  this.authority=HostAuthority.fromRecovery(value.authority,this.random);
  this.seats=value.seats.map((seat,index)=>({id:seat.id,name:cleanName(seat.name,seat.id),token:seat.token,peer:currentPeers.get(seat.id)??null,connected:index===0||(currentPeers.get(seat.id)!=null),ready:false}));
  this.seats[0].connected=true;this.seats[0].peer=null;
  this.recovering=paused;
 }
 disconnect(peer:string){
  if(this.spectators.delete(peer)){this.announce();return;}
  const seat=this.seats.find(s=>s.peer===peer);if(seat){seat.peer=null;seat.connected=false;seat.ready=false;this.announce();}
 }
 receive(peer:string,text:string){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>16384)return;
  let msg:{protocol?:unknown;type?:unknown;token?:unknown;name?:unknown;ready?:unknown;command?:unknown;role?:unknown;boardLayout?:unknown;mapSeed?:unknown};try{msg=JSON.parse(text);}catch{return;}
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.protocol!==1||typeof msg.type!=='string')return;
  if(msg.type==='hello'){
   if(this.seats.some(s=>s.peer===peer)||this.spectators.has(peer))return;
   let seat:Seat|undefined;
   if(typeof msg.token==='string'&&msg.token)seat=this.seats.find(s=>s.token===msg.token);
   else if(msg.token===undefined||msg.token===''){
    if(this.authority||msg.role==='spectator'){
     this.spectators.add(peer);this.output(peer,'spectator',{watching:!!this.authority});this.announce();
     if(this.authority&&!this.recovering)this.output(peer,'snapshot',this.decorate(this.authority.spectatorSnapshot()));
     return;
    }
    seat=this.claimSeat(peer,msg.name)??undefined;
    if(!seat){
     this.spectators.add(peer);this.output(peer,'spectator',{watching:false});this.announce();return;
    }
   }
   if(!seat){this.output(peer,'error','Seat unavailable.');return;}
   const stalePeer=seat.peer;
   if(!this.authority)seat.name=cleanName(msg.name,seat.name||seat.id);
   seat.peer=peer;seat.connected=true;seat.ready=false;
   this.output(peer,'seat',{id:seat.id,token:seat.token,gameId:this.gameId||null});this.announce();
   if(stalePeer&&stalePeer!==peer){/* stale peer no longer controls the credential */}
   if(this.authority&&!this.recovering)this.output(peer,'snapshot',this.decorate(this.authority.snapshot(seat.id)));
   return;
  }
  const seat=this.seats.find(s=>s.peer===peer&&s.connected);
  const spectator=this.spectators.has(peer);
  if(!seat&&!spectator)return;
  if(msg.type==='role'&&!this.authority&&(msg.role==='player'||msg.role==='spectator')){
   if(seat&&seat.id!=='Player 1'&&msg.role==='spectator'){
    this.seats.splice(this.seats.indexOf(seat),1);
    this.spectators.add(peer);this.output(peer,'spectator',{watching:false});this.announce();
   }else if(spectator&&msg.role==='player'){
    const claimed=this.claimSeat(peer,msg.name);
    if(!claimed){this.output(peer,'error','All player seats are occupied.');return;}
    this.spectators.delete(peer);this.output(peer,'seat',{id:claimed.id,token:claimed.token,gameId:null});this.announce();
   }
   return;
  }
  if(msg.type==='name' && seat && !this.authority){seat.name=cleanName(msg.name,seat.name||seat.id);this.announce();return;}
  if(msg.type==='ready' && seat && !this.authority && typeof msg.ready==='boolean'){seat.ready=msg.ready;this.announce();return;}
  // Only the host controls the selected board. Guests receive an identical preview in lobby announcements.
  if(msg.type==='map')return;
  if(msg.type==='sync' && this.authority && !this.recovering){
   this.output(peer,'snapshot',seat?this.decorate(this.authority.snapshot(seat.id)):this.decorate(this.authority.spectatorSnapshot()));return;
  }
  if(msg.type==='command' && this.authority && typeof msg.command==='string'){
   if(!seat){this.output(peer,'rejection',{ok:false,code:'spectator',revision:this.authority.currentRevision()});return;}
   if(this.recovering){this.output(peer,'rejection',{ok:false,code:'recovery-pending',revision:this.authority.currentRevision()});return;}
   const result=this.authority.receive(seat.id,msg.command);
   if(!result.ok)this.output(peer,'rejection',result);else{this.emitCheckpoint();this.broadcast();}
  }
 }
 setHostName(name:string){if(this.authority)throw new Error('Game started.');this.seats[0].name=cleanName(name,this.seats[0].name);this.announce();}
 setHostReady(ready:boolean){if(this.authority)throw new Error('Game started.');this.seats[0].ready=ready;this.announce();}
 setMapSelection(layout:BoardLayout,seed:number){
  if(this.authority||this.recovering)throw new Error('Map selection is only available before a game starts.');
  if(layout!=='standard'&&layout!=='expanded-5-6')throw new Error('Invalid board layout.');
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid map seed.');
  if(layout==='standard'&&this.seats.length>4)throw new Error('Too many seated players for a standard board.');
  if(layout===this.boardLayout&&seed===this.mapSeed)return;
  this.boardLayout=layout;this.mapSeed=seed;
  for(const seat of this.seats)seat.ready=false;
  this.announce();
 }
 restart(){
  if(!this.authority||this.recovering)throw new Error('No running game to restart.');
  this.gameId=this.token();
  this.authority=new HostAuthority(this.gameId,createGame(this.mapSeed,this.seats.map(seat=>seat.id),this.random,{qaTwoPlayers:this.qaTwoPlayers,boardLayout:this.boardLayout}),this.random);
  for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'restart',{gameId:this.gameId});
  for(const peer of this.spectators)this.output(peer,'restart',{gameId:this.gameId});
  this.announce();this.emitCheckpoint(true);this.broadcast();
 }
 start(seed:number){
  const countValid=this.boardLayout==='expanded-5-6'?this.seats.length>=5&&this.seats.length<=6:this.seats.length>=2&&this.seats.length<=4;
  if(this.authority||!countValid||this.seats.some(s=>!s.connected||!s.ready))throw new Error(this.boardLayout==='expanded-5-6'?'Five to six connected, ready players are required for the 5–6 player board.':'Two to four connected, ready players are required for the standard board.');
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid map seed.');
  this.mapSeed=seed;this.gameId=this.token();const state=createGame(seed,this.seats.map(s=>s.id),this.random,{qaTwoPlayers:this.qaTwoPlayers,boardLayout:this.boardLayout});this.authority=new HostAuthority(this.gameId,state,this.random);this.recovering=false;this.announce();this.emitCheckpoint();this.broadcast();
 }
 resume(value:unknown){
  if(!this.recovering)throw new Error('No saved game is waiting to resume.');
  if(!this.allSeatsConnected())throw new Error('All original players must reconnect before resuming.');
  const recovery=parseSessionRecovery(value);
  const current=this.recovery();
  if(recovery.authority.gameId!==current.authority.gameId||recovery.qaTwoPlayers!==current.qaTwoPlayers||recovery.boardLayout!==current.boardLayout||recovery.seats.length!==current.seats.length||recovery.seats.some((seat,index)=>seat.id!==current.seats[index].id||seat.token!==current.seats[index].token))throw new Error('Saved game does not belong to this room session.');
  const peers=new Map(this.seats.map(seat=>[seat.id,seat.peer]));
  this.restoreRecovery(recovery,false);
  for(const seat of this.seats){seat.peer=peers.get(seat.id)??null;seat.connected=seat.id==='Player 1'||seat.peer!==null;}
  for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'resume',{gameId:recovery.authority.gameId,revision:recovery.authority.revision});
  for(const peer of this.spectators)this.output(peer,'resume',{gameId:recovery.authority.gameId,revision:recovery.authority.revision});
  this.announce();this.emitCheckpoint(true);this.broadcast();
 }
 submit(command:Record<string,unknown>,commandId:string,revision:number){
  if(!this.authority)throw new Error('Game not started.');
  if(this.recovering)throw new Error('Saved game is waiting to resume.');
  const message=JSON.stringify({protocol:1,gameId:this.gameId,revision,commandId,sender:'Player 1',command:{...command,playerId:'Player 1'}});
  const result=this.authority.receive('Player 1',message);if(result.ok){this.emitCheckpoint();this.broadcast();}return result;
 }
 private decorate<T extends {public:{players:Array<{id:string;name:string}>}}>(snapshot:T):T {
  const names=new Map(this.seats.map(seat=>[seat.id,seat.name]));
  const copy=structuredClone(snapshot);
  copy.public.players=copy.public.players.map(player=>({...player,name:names.get(player.id)??player.name??player.id}));
  return copy;
 }
 private broadcast(){
  if(!this.authority||this.recovering)return;
  this.publish({type:'snapshot',data:this.decorate(this.authority.snapshot('Player 1'))});
  for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'snapshot',this.decorate(this.authority.snapshot(seat.id)));
  const spectatorSnapshot=this.decorate(this.authority.spectatorSnapshot());
  for(const peer of this.spectators)this.output(peer,'snapshot',spectatorSnapshot);
 }
}
