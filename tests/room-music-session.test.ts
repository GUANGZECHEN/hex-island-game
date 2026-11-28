import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomMusicGuest, isRoomMusicMessage } from '../src/game/network/room-music.ts';
import { createGame } from '../src/game/rules/state.ts';
import type { SessionRecovery } from '../src/game/network/recovery.ts';
import { HostSession } from '../src/game/network/session.ts';

test('room music reaches only listening participants and evicts a replaced seat immediately',()=>{
 const sent:Array<{peer:string; message:{type:string; data?:{token:string}; action?:string}; bestEffort?:boolean}>=[];
 const subscribers:boolean[]=[];
 const host=new HostSession(
  (peer,text,bestEffort)=>{sent.push({peer,message:JSON.parse(text),bestEffort});},
  event=>{const value=event as {type:string; data:boolean};if(value.type==='music-subscribers')subscribers.push(value.data);},
  ()=>'s'.repeat(43),()=>0,
 );
 const hello=(peer:string,options:object={})=>host.receive(peer,JSON.stringify({protocol:1,type:'hello',...options}));
 let listenMessage='';
 const guest=(peer:string)=>new RoomMusicGuest(text=>{
  listenMessage=text;host.receive(peer,text);
 },{availability:()=>{},frame:()=>{},reset:()=>{}},true);
 const deliverMusic=(peer:string,listener:RoomMusicGuest)=>{
  for(const {message} of sent.filter(item=>item.peer===peer&&isRoomMusicMessage(item.message)))listener.receive(message);
 };
 const payload='A'.repeat(4800);
 const frames=()=>sent.filter(item=>item.message.action==='frame');

 host.setMusicSharing(true);
 const seatListener=guest('seat');
 hello('seat');
 const seatToken=sent.find(item=>item.peer==='seat'&&item.message.type==='seat')?.message.data?.token;
 assert.ok(seatToken);
 assert.ok(sent.findIndex(item=>item.peer==='seat'&&item.message.type==='seat')
  <sent.findIndex(item=>item.peer==='seat'&&item.message.action==='offer'));
 deliverMusic('seat',seatListener);
 assert.ok(listenMessage);
 host.receive('unadmitted',listenMessage);
 host.publishMusicFrame(payload);
 assert.deepEqual(frames().map(item=>[item.peer,item.bestEffort]),[['seat',true]]);

 // A reconnect changes the admitted peer before the old socket's leave event.
 const staleListen=listenMessage;
 sent.length=0;
 const replacement=guest('replacement');
 hello('replacement',{token:seatToken});
 host.receive('seat',staleListen);
 host.publishMusicFrame(payload);
 assert.deepEqual(frames(),[]);
 deliverMusic('replacement',replacement);

 const spectator=guest('spectator');
 hello('spectator',{role:'spectator'});
 deliverMusic('spectator',spectator);
 host.publishMusicFrame(payload);
 assert.deepEqual(frames().map(item=>item.peer).sort(),['replacement','spectator']);
 assert.deepEqual(subscribers,[true,false,true]);

 host.disconnectMany(['replacement','spectator']);
 host.receive('spectator',listenMessage);
 sent.length=0;
 host.publishMusicFrame(payload);
 assert.deepEqual(frames(),[]);
 assert.deepEqual(subscribers,[true,false,true,false]);
});

test('host audio boundaries reset current listeners and fence off older frames',()=>{
 const sent:Array<{peer:string; message:unknown; bestEffort?:boolean}>=[];
 const subscriberChanges:boolean[]=[];
 const host=new HostSession(
  (peer,text,bestEffort)=>{sent.push({peer,message:JSON.parse(text),bestEffort});},
  event=>{const value=event as {type:string; data:boolean};if(value.type==='music-subscribers')subscriberChanges.push(value.data);},
  ()=>'s'.repeat(43),()=>0,
 );
 let resetCount=0;
 const received:string[]=[];
 const guest=new RoomMusicGuest(text=>host.receive('listener',text),{
  availability:()=>{},frame:data=>received.push(data),reset:()=>{resetCount++;},
 });
 const hello=(peer:string,role:string)=>host.receive(peer,JSON.stringify({protocol:1,type:'hello',role}));
 host.setMusicSharing(true);
 host.resetMusicPlayback();
 assert.deepEqual(sent,[]);

 hello('listener','player');
 hello('not-listening','spectator');
 for(const {peer,message} of sent)if(peer==='listener'&&isRoomMusicMessage(message))guest.receive(message);
 const baselineResets=resetCount;
 sent.length=0;

 const staleData='A'.repeat(4800);
 host.publishMusicFrame(staleData);
 const staleFrame=sent.pop();
 assert.ok(staleFrame);
 assert.equal(staleFrame.peer,'listener');

 host.resetMusicPlayback();
 assert.equal(sent.length,1);
 const reset=sent.pop()!;
 assert.equal(reset.peer,'listener');
 assert.notEqual(reset.bestEffort,true);
 guest.receive(reset.message);
 assert.equal(resetCount,baselineResets+1);

 guest.receive(staleFrame.message);
 assert.deepEqual(received,[]);
 const freshData='B'.repeat(4800);
 host.publishMusicFrame(freshData);
 assert.equal(sent.length,1);
 guest.receive(sent[0].message);
 assert.deepEqual(received,[freshData]);
 assert.deepEqual(subscriberChanges,[true]);
});

for (const hostWins of [true,false]) test(`finished music reaches only the matching listeners when ${hostWins?'host':'guest'} wins`,()=>{
 const ids=['Player 1','Player 2','Player 3','Player 4'],winner=hostWins?0:1;
 const game=createGame(47,ids,()=>0);game.currentSeat=winner;game.turn=4;game.phase='action';
 game.players[winner].cards=Array.from({length:10},()=>({type:'victory-point' as const,boughtTurn:1}));
 const saved:SessionRecovery={version:1,qaTwoPlayers:false,boardLayout:'standard',authority:{version:1,gameId:'sound-end',revision:3,state:game},
  seats:ids.map((id,i)=>({id,token:i?String(i).repeat(43):''}))};
 const audio=new Map<string,string[]>(),listeners=new Map<string,RoomMusicGuest>();
 const wire:Array<{id:string;message:Record<string,unknown>}>=[];let serial=0;
 const host=HostSession.fromRecovery((id,text)=>{
  const message=JSON.parse(text);if(isRoomMusicMessage(message)){wire.push({id,message});listeners.get(id)?.receive(message);}
 },()=>{},()=>String(++serial).padStart(43,'z'),()=>0,saved);
 const join=(peer:string,seat:number|null,enabled=true)=>{
  audio.set(peer,[]);
  listeners.set(peer,new RoomMusicGuest(text=>host.receive(peer,text),{availability:()=>{},frame:data=>audio.get(peer)!.push(data),reset:()=>{}},enabled));
  host.receive(peer,JSON.stringify({protocol:1,type:'hello',...(seat===null?{role:'spectator'}:{token:saved.seats[seat].token})}));
 };
 const table='A'.repeat(4800),win='W'.repeat(4800),loss='L'.repeat(4800);
 host.setMusicSharing(true);
 join('second',1);join('third',2);join('muted',3,false);join('observer',null);
 host.resume(saved);
 host.publishMusicFrame(table);
 const stale=wire.find(x=>x.id==='second'&&x.message.action==='frame')!.message;
 assert.deepEqual(audio.get('observer'),[table]);
 const command={type:'claim-victory',playerId:ids[winner]};
 if(hostWins)assert.equal(host.submit(command,'win',3).ok,true);
 else host.receive('second',JSON.stringify({protocol:1,type:'command',command:JSON.stringify({protocol:1,gameId:'sound-end',revision:3,commandId:'win',sender:ids[winner],command})}));
 assert.equal(host.recovery().authority.state.winner,ids[winner]);
 for(const heard of audio.values())heard.length=0;
 listeners.get('second')!.receive(stale);
 host.publishMusicFrame(hostWins?win:loss,'table');
 host.publishMusicFrame(hostWins?loss:win,'opposite');
 assert.deepEqual(audio.get('second'),[hostWins?loss:win]);assert.deepEqual(audio.get('third'),[loss]);
 assert.deepEqual(audio.get('observer'),[]);assert.deepEqual(audio.get('muted'),[]);
 host.disconnect('second');join('rejoined',1);join('later-spectator',null);
 host.publishMusicFrame(hostWins?loss:win,'opposite');host.publishMusicFrame(hostWins?win:loss,'table');
 assert.deepEqual(audio.get('rejoined'),[hostWins?loss:win]);assert.deepEqual(audio.get('later-spectator'),[]);
 host.restart();
 for(const heard of audio.values())heard.length=0;
 host.publishMusicFrame(win,'opposite');host.publishMusicFrame(table);
 assert.deepEqual(audio.get('rejoined'),[table]);assert.deepEqual(audio.get('third'),[table]);assert.deepEqual(audio.get('observer'),[table]);
 assert.deepEqual(audio.get('muted'),[]);
});
