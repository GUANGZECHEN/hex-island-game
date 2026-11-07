import { createGame } from '../rules/state.ts';
import { HostAuthority } from './authority.ts';

export interface LobbySeat { id:string; connected:boolean; ready:boolean }
interface Seat extends LobbySeat { peer:string | null; token:string }
type Send = (peer:string, message:string)=>void;
/** Host-only session. Credentials must be generated with cryptographically secure randomness. */
export class HostSession {
 private seats:Seat[]; private authority:HostAuthority|null=null; private gameId='';
 constructor(privateSend:Send, privatePublish:(value:unknown)=>void, privateToken:()=>string, privateRandom:()=>number, options: { qaTwoPlayers?: boolean } = {}) {
  this.send=privateSend;this.publish=privatePublish;this.token=privateToken;this.random=privateRandom;this.qaTwoPlayers=options.qaTwoPlayers === true;
  this.seats=[{id:'Player 1',connected:true,ready:false,peer:null,token:''}];
 }
 private qaTwoPlayers:boolean; private send:Send; private publish:(value:unknown)=>void; private token:()=>string; private random:()=>number;
 lobby():LobbySeat[]{return this.seats.map(({id,connected,ready})=>({id,connected,ready}));}
 private output(peer:string,type:string,data:unknown){this.send(peer,JSON.stringify({protocol:1,type,data}));}
 private announce(){const lobby={seats:this.lobby(),qaTwoPlayers:this.qaTwoPlayers};this.publish({type:'lobby',lobby});for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'lobby',lobby);}
 disconnect(peer:string){const seat=this.seats.find(s=>s.peer===peer);if(seat){seat.peer=null;seat.connected=false;seat.ready=false;this.announce();}}
 receive(peer:string,text:string){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>16384)return;
  let msg:{protocol?:unknown;type?:unknown;token?:unknown;ready?:unknown;command?:unknown};try{msg=JSON.parse(text);}catch{return;}
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.protocol!==1||typeof msg.type!=='string')return;
  if(msg.type==='hello'){
   if(this.seats.some(s=>s.peer===peer))return;
   let seat:Seat|undefined;
   if(typeof msg.token==='string' && msg.token) seat=this.seats.find(s=>s.token===msg.token);
   else if ((msg.token === undefined || msg.token === '') && !this.authority) {
    const vacant = this.seats.find((s,index) => index > 0 && !s.connected);
    if (vacant || this.seats.length < (this.qaTwoPlayers ? 2 : 4)) {
     const credential=this.token();
     if(!/^[A-Za-z0-9_-]{43}$/.test(credential)||this.seats.some(s=>s.token===credential))throw new Error('Invalid seat credential.');
     if(vacant){seat=vacant;seat.token=credential;seat.ready=false;}
     else {seat={id:`Player ${this.seats.length+1}`,connected:true,ready:false,peer:null,token:credential};this.seats.push(seat);}
    }
   }
   if(!seat){this.output(peer,'error','Seat unavailable.');return;}
   seat.peer=peer;seat.connected=true;this.output(peer,'seat',{id:seat.id,token:seat.token});this.announce();if(this.authority)this.output(peer,'snapshot',this.authority.snapshot(seat.id));return;
  }
  const seat=this.seats.find(s=>s.peer===peer&&s.connected);if(!seat)return;
  if(msg.type==='ready' && !this.authority && typeof msg.ready==='boolean'){seat.ready=msg.ready;this.announce();return;}
  if(msg.type==='sync' && this.authority){this.output(peer,'snapshot',this.authority.snapshot(seat.id));return;}
  if(msg.type==='command' && this.authority && typeof msg.command==='string'){
   const result=this.authority.receive(seat.id,msg.command);if(!result.ok)this.output(peer,'rejection',result);else this.broadcast();
  }
 }
 setHostReady(ready:boolean){if(this.authority)throw new Error('Game started.');this.seats[0].ready=ready;this.announce();}
 start(seed:number){
  const countValid=this.qaTwoPlayers ? this.seats.length===2 : this.seats.length>=3 && this.seats.length<=4;
  if(this.authority||!countValid||this.seats.some(s=>!s.connected||!s.ready))throw new Error(this.qaTwoPlayers ? 'Two connected, ready players are required in QA mode.' : 'Three or four connected, ready players are required.');
  this.gameId=this.token();const state=createGame(seed,this.seats.map(s=>s.id),this.random,{qaTwoPlayers:this.qaTwoPlayers});this.authority=new HostAuthority(this.gameId,state,this.random);this.broadcast();
 }
 submit(command:Record<string,unknown>,commandId:string,revision:number){
  if(!this.authority)throw new Error('Game not started.');const message=JSON.stringify({protocol:1,gameId:this.gameId,revision,commandId,sender:'Player 1',command:{...command,playerId:'Player 1'}});
  const result=this.authority.receive('Player 1',message);if(result.ok)this.broadcast();return result;
 }
 private broadcast(){if(!this.authority)return;this.publish({type:'snapshot',data:this.authority.snapshot('Player 1')});for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'snapshot',this.authority.snapshot(seat.id));}
}
