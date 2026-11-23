import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomMusicGuest, isRoomMusicMessage } from '../src/game/network/room-music.ts';
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
