import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/game/network/session.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';

for(const count of [2,3,4])test(`${count}-player lobby starts, projects private state and restores a guest seat`,()=>{
 const messages=new Map<string,unknown[]>(),published:unknown[]=[];let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>12345);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 for(let i=2;i<=count;i++){send(`peer${i}`,{type:'hello'});send(`peer${i}`,{type:'ready',ready:true});}
 assert.throws(()=>host.start(1));host.setHostReady(true);host.start(1);
 for(let i=2;i<=count;i++){
  const list=messages.get(`peer${i}`) as Array<{type:string;data:any}>;const snapshot=list.find(x=>x.type==='snapshot')!.data;
  assert.equal(snapshot.public.players.length,count);assert.ok(snapshot.private);assert.ok(!('randomState' in snapshot.public));assert.ok(!('deck' in snapshot.public));
 }
 const seat=(messages.get('peer2') as Array<{type:string;data:any}>).find(x=>x.type==='seat')!.data;
 host.disconnect('peer2');send('attacker',{type:'hello',token:'invalid'});assert.equal(host.lobby()[1].connected,false);
 send('new-peer',{type:'hello',token:seat.token});assert.equal(host.lobby()[1].connected,true);
 const resumed=messages.get('new-peer') as Array<{type:string;data:any}>;assert.equal(resumed.find(x=>x.type==='seat')!.data.id,seat.id);assert.ok(resumed.some(x=>x.type==='snapshot'));
});
test('gameplay commands propagate to every connected peer with a new revision',()=>{
 const messages=new Map<string,unknown[]>(),published:unknown[]=[];let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>12345);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 for(const peer of ['two','three']){send(peer,{type:'hello'});send(peer,{type:'ready',ready:true});}host.setHostReady(true);host.start(1);
 const initial=(published.at(-1) as any).data,active=initial.public.players[initial.public.currentSeat].id;
 const vertex=initial.public.board.hexes[0].hexId;
 // Invalid logical targets never advance revision or disclose private state.
 const bad={protocol:1,gameId:initial.gameId,revision:0,commandId:'bad',sender:active,command:{type:'place-settlement',playerId:active,vertexId:vertex}};
 const peer=active==='Player 2'?'two':'three';
 if(active==='Player 1')assert.equal(host.submit({type:'place-settlement',vertexId:vertex},'bad',0).ok,false);
 else send(peer,{type:'command',command:JSON.stringify(bad)});
 const target=createIslandBoard().vertices[0].id;
 if(active==='Player 1')assert.equal(host.submit({type:'place-settlement',vertexId:target},'valid',0).ok,true);
 else send(peer,{type:'command',command:JSON.stringify({...bad,commandId:'valid',command:{...bad.command,vertexId:target}})});
 const updated=(published.at(-1) as any).data;assert.equal(updated.revision,1);assert.equal(updated.public.phase,'setup-road');
 for(const key of ['two','three']){const snapshots=(messages.get(key) as any[]).filter(x=>x.type==='snapshot');assert.equal(snapshots.at(-1).data.revision,1);}
});

for(const count of [2,3,4])test(`${count}-player pre-game replacement reuses the lowest disconnected seat with a fresh credential`,()=>{
 const messages=new Map<string,any[]>();let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),()=>{},()=>String(++serial).padStart(43,'a'),()=>1);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 for(let i=2;i<=count;i++){send(`p${i}`,{type:'hello'});send(`p${i}`,{type:'ready',ready:true});}
 const old=messages.get('p2')!.find(x=>x.type==='seat').data;host.disconnect('p2');
 send('replacement',{type:'hello'});const replacement=messages.get('replacement')!.find(x=>x.type==='seat').data;
 assert.equal(replacement.id,'Player 2');assert.notEqual(replacement.token,old.token);assert.equal(host.lobby().length,count);
 host.disconnect('replacement');send('old-seat',{type:'hello',token:old.token});assert.equal(messages.get('old-seat')!.at(-1).type,'error');
 send('replacement-2',{type:'hello',token:replacement.token});send('replacement-2',{type:'ready',ready:true});host.setHostReady(true);assert.doesNotThrow(()=>host.start(1));
});

test('standard rooms start with any fully-ready player count from 2 through 4',()=>{
 let serial=0;
 const make=()=>new HostSession(()=>{},()=>{},()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(host:HostSession,id:string,message:object)=>host.receive(id,JSON.stringify({protocol:1,...message}));
 for(const count of [2,3,4]){
  const host=make();
  for(let i=2;i<=count;i++){send(host,`p${i}`,{type:'hello'});send(host,`p${i}`,{type:'ready',ready:true});}
  host.setHostReady(true);assert.doesNotThrow(()=>host.start(count));
 }
 const host=make();host.setHostReady(true);assert.throws(()=>host.start(1),/Two to four/);
});

test('a fifth pre-game visitor gets no seat, while post-start visitors become public-only spectators',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 for(const peer of ['p2','p3','p4']){send(peer,{type:'hello'});send(peer,{type:'ready',ready:true});}
 send('p5',{type:'hello'});assert.equal(messages.get('p5')!.at(-1).type,'error');assert.equal(host.lobby().length,4);
 host.setHostReady(true);host.start(37);
 send('watcher',{type:'hello'});
 const watcher=messages.get('watcher')!;
 assert.ok(watcher.some(x=>x.type==='spectator'));
 const snapshot=watcher.find(x=>x.type==='snapshot').data;
 assert.equal(snapshot.private,null);assert.equal(snapshot.public.players.length,4);assert.equal(host.spectatorCount(),1);
 send('watcher',{type:'ready',ready:true});assert.equal(host.spectatorCount(),1);
 send('watcher',{type:'command',command:'{}'});assert.equal(messages.get('watcher')!.at(-1).data.code,'spectator');
 host.disconnect('watcher');assert.equal(host.spectatorCount(),0);
});

test('two-player QA uses normal authority, private projection, revision and credential-bound resync',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>0,{qaTwoPlayers:true});
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('guest',{type:'hello'});const seat=messages.get('guest')!.find(x=>x.type==='seat').data;send('guest',{type:'ready',ready:true});host.setHostReady(true);host.start(9);
 let snapshot=published.at(-1).data;assert.equal(snapshot.public.players.length,2);assert.equal(snapshot.public.currentSeat,0);
 assert.equal(host.submit({type:'place-settlement',vertexId:createIslandBoard().vertices[0].id},'host-place',0).ok,true);
 snapshot=published.at(-1).data;assert.equal(snapshot.revision,1);const edge=createIslandBoard().edges.find(e=>e.vertexIds.includes(snapshot.public.pendingSettlement))!;
 assert.equal(host.submit({type:'place-road',edgeId:edge.id},'host-road',1).ok,true);
 snapshot=messages.get('guest')!.filter(x=>x.type==='snapshot').at(-1).data;assert.equal(snapshot.revision,2);assert.equal(snapshot.public.currentSeat,1);
 for(const player of snapshot.public.players){assert.equal('hand' in player,false);assert.equal('cards' in player,false);}assert.ok(snapshot.private.hand);
 const command={protocol:1,gameId:snapshot.gameId,revision:2,commandId:'guest-place',sender:seat.id,command:{type:'place-settlement',playerId:seat.id,vertexId:createIslandBoard().vertices.find(v=>!createIslandBoard().edges.some(e=>e.vertexIds.includes(v.id)&&e.vertexIds.includes(createIslandBoard().vertices[0].id))&&v.id!==createIslandBoard().vertices[0].id)!.id}};
 send('guest',{type:'command',command:JSON.stringify(command)});assert.equal(published.at(-1).data.revision,3);
 host.disconnect('guest');send('stranger',{type:'hello'});assert.ok(messages.get('stranger')!.some(x=>x.type==='spectator'));assert.equal(messages.get('stranger')!.find(x=>x.type==='snapshot').data.private,null);
 send('resumed',{type:'hello',token:seat.token});const restored=messages.get('resumed')!.find(x=>x.type==='snapshot').data;assert.equal(restored.revision,3);assert.equal(messages.get('resumed')!.find(x=>x.type==='seat').data.id,seat.id);
 send('resumed',{type:'sync'});const synced=messages.get('resumed')!.filter(x=>x.type==='snapshot').at(-1).data;assert.equal(synced.revision,3);assert.equal(synced.public.currentSeat,restored.public.currentSeat);
 send('resumed',{type:'command',command:JSON.stringify({...command,commandId:'stale'})});assert.equal(messages.get('resumed')!.at(-1).data.code,'stale');
});


test('valid seat credential can reclaim a stale still-connected peer',()=>{
 const messages=new Map<string,any[]>();let serial=0;
 const host=new HostSession(
  (peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),
  ()=>{},
  ()=>String(++serial).padStart(43,'a'),
  ()=>1,
  {qaTwoPlayers:true},
 );
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('old-peer',{type:'hello'});
 const seat=messages.get('old-peer')!.find(x=>x.type==='seat').data;
 assert.equal(host.lobby()[1].connected,true);

 // Simulate a reconnect racing ahead of the old WebSocket close/leave event.
 send('new-peer',{type:'hello',token:seat.token});
 const reclaimed=messages.get('new-peer')!.find(x=>x.type==='seat').data;
 assert.equal(reclaimed.id,seat.id);
 assert.equal(host.lobby()[1].connected,true);

 // The stale peer can no longer act for the seat.
 send('old-peer',{type:'ready',ready:true});
 assert.equal(host.lobby()[1].ready,false);
 send('new-peer',{type:'ready',ready:true});
 assert.equal(host.lobby()[1].ready,true);

 // A delayed leave from the stale peer must not disconnect the replacement.
 host.disconnect('old-peer');
 assert.equal(host.lobby()[1].connected,true);
});


test('saved session restores original seats and waits for everyone before resume',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const sendOut=(peer:string,text:string)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]);
 const token=()=>String(++serial).padStart(43,'a');
 const host=new HostSession(sendOut,x=>published.push(x),token,()=>0,{qaTwoPlayers:true});
 const send=(session:HostSession,peer:string,message:object)=>session.receive(peer,JSON.stringify({protocol:1,...message}));
 send(host,'guest',{type:'hello'});
 const seat=messages.get('guest')!.find(x=>x.type==='seat').data;
 send(host,'guest',{type:'ready',ready:true});host.setHostReady(true);host.start(31);
 const checkpoint=published.filter(x=>x.type==='checkpoint').at(-1);
 assert.ok(checkpoint);assert.equal(checkpoint.round,0);assert.ok(JSON.stringify(checkpoint.data).length<49152);

 const recoveredMessages=new Map<string,any[]>(),recoveredPublished:any[]=[];
 const restored=HostSession.fromRecovery(
  (peer,text)=>recoveredMessages.set(peer,[...(recoveredMessages.get(peer)??[]),JSON.parse(text)]),
  x=>recoveredPublished.push(x),
  token,
  ()=>0,
  checkpoint.data,
 );
 assert.equal(restored.isRecovering(),true);
 assert.equal(restored.lobby()[0].connected,true);
 assert.equal(restored.lobby()[1].connected,false);
 assert.throws(()=>restored.resume(checkpoint.data),/All original players/);

 send(restored,'guest-returned',{type:'hello',token:seat.token});
 assert.equal(restored.lobby()[1].connected,true);
 assert.equal(restored.allSeatsConnected(),true);
 restored.resume(checkpoint.data);
 assert.equal(restored.isRecovering(),false);
 const returned=recoveredMessages.get('guest-returned')!;
 assert.ok(returned.some(x=>x.type==='resume'&&x.data.gameId===checkpoint.data.authority.gameId));
 const snapshot=returned.filter(x=>x.type==='snapshot').at(-1).data;
 assert.equal(snapshot.revision,checkpoint.data.authority.revision);
 assert.equal(snapshot.public.board.seed,31);
 assert.equal(recoveredPublished.filter(x=>x.type==='checkpoint').at(-1).replace,true);
});
