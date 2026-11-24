import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/game/network/session.ts';
import { createGame } from '../src/game/rules/state.ts';
import { generateBoardSetup, GENERATOR_VERSION, TWIN_CAPES_VERSION } from '../src/game/board/setup.ts';
import { parseSessionRecovery, type SessionRecovery } from '../src/game/network/recovery.ts';
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
 const initial=(published.filter(x=>(x as any).type==='snapshot').at(-1) as any).data,active=initial.public.players[initial.public.currentSeat].id;
 const vertex=initial.public.board.hexes[0].hexId;
 // Invalid logical targets never advance revision or disclose private state.
 const bad={protocol:1,gameId:initial.gameId,revision:0,commandId:'bad',sender:active,command:{type:'place-settlement',playerId:active,vertexId:vertex}};
 const peer=active==='Player 2'?'two':'three';
 if(active==='Player 1')assert.equal(host.submit({type:'place-settlement',vertexId:vertex},'bad',0).ok,false);
 else send(peer,{type:'command',command:JSON.stringify(bad)});
 const target=createIslandBoard().vertices[0].id;
 if(active==='Player 1')assert.equal(host.submit({type:'place-settlement',vertexId:target},'valid',0).ok,true);
 else send(peer,{type:'command',command:JSON.stringify({...bad,commandId:'valid',command:{...bad.command,vertexId:target}})});
 const updated=(published.filter(x=>(x as any).type==='snapshot').at(-1) as any).data;assert.equal(updated.revision,1);assert.equal(updated.public.phase,'setup-road');
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
 send('p5',{type:'hello'});assert.equal(messages.get('p5')!.some(x=>x.type==='spectator'),true);assert.equal(host.lobby().length,4);
 host.setHostReady(true);host.start(37);
 send('watcher',{type:'hello'});
 const watcher=messages.get('watcher')!;
 assert.ok(watcher.some(x=>x.type==='spectator'));
 const snapshot=watcher.find(x=>x.type==='snapshot').data;
 assert.equal(snapshot.private,null);assert.equal(snapshot.public.players.length,4);assert.equal(host.spectatorCount(),2);
 send('watcher',{type:'ready',ready:true});assert.equal(host.spectatorCount(),2);
 send('watcher',{type:'command',command:'{}'});assert.equal(messages.get('watcher')!.at(-1).data.code,'spectator');
 host.disconnect('watcher');assert.equal(host.spectatorCount(),1);
});

test('two-player QA uses normal authority, private projection, revision and credential-bound resync',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>0,{qaTwoPlayers:true});
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('guest',{type:'hello'});const seat=messages.get('guest')!.find(x=>x.type==='seat').data;send('guest',{type:'ready',ready:true});host.setHostReady(true);host.start(9);
 let snapshot=published.filter(x=>x.type==='snapshot').at(-1).data;assert.equal(snapshot.public.players.length,2);assert.equal(snapshot.public.currentSeat,0);
 assert.equal(host.submit({type:'place-settlement',vertexId:createIslandBoard().vertices[0].id},'host-place',0).ok,true);
 snapshot=published.filter(x=>x.type==='snapshot').at(-1).data;assert.equal(snapshot.revision,1);const edge=createIslandBoard().edges.find(e=>e.vertexIds.includes(snapshot.public.pendingSettlement))!;
 assert.equal(host.submit({type:'place-road',edgeId:edge.id},'host-road',1).ok,true);
 snapshot=messages.get('guest')!.filter(x=>x.type==='snapshot').at(-1).data;assert.equal(snapshot.revision,2);assert.equal(snapshot.public.currentSeat,1);
 for(const player of snapshot.public.players){assert.equal('hand' in player,false);assert.equal('cards' in player,false);}assert.ok(snapshot.private.hand);
 const command={protocol:1,gameId:snapshot.gameId,revision:2,commandId:'guest-place',sender:seat.id,command:{type:'place-settlement',playerId:seat.id,vertexId:createIslandBoard().vertices.find(v=>!createIslandBoard().edges.some(e=>e.vertexIds.includes(v.id)&&e.vertexIds.includes(createIslandBoard().vertices[0].id))&&v.id!==createIslandBoard().vertices[0].id)!.id}};
 send('guest',{type:'command',command:JSON.stringify(command)});assert.equal(published.filter(x=>x.type==='snapshot').at(-1).data.revision,3);
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


test('nicknames are display-only, propagate in lobby/snapshots and survive recovery',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession(
  (peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),
  value=>published.push(value),
  ()=>String(++serial).padStart(43,'a'),
  ()=>0,
 );
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 host.setHostName('Alice');
 send('guest',{type:'hello',name:'Bob'});
 assert.deepEqual(host.lobby().map(seat=>[seat.id,seat.name]),[['Player 1','Alice'],['Player 2','Bob']]);
 send('guest',{type:'name',name:'Bobby'});
 assert.equal(host.lobby()[1].name,'Bobby');
 const seat=messages.get('guest')!.find(x=>x.type==='seat').data;
 send('guest',{type:'ready',ready:true});host.setHostReady(true);host.start(41);
 const snapshot=published.filter(x=>x.type==='snapshot').at(-1).data;
 assert.deepEqual(snapshot.public.players.map((player:any)=>[player.id,player.name]),[['Player 1','Alice'],['Player 2','Bobby']]);
 assert.equal(snapshot.private.hand!==undefined,true);
 const checkpoint=published.filter(x=>x.type==='checkpoint').at(-1).data;
 assert.deepEqual(checkpoint.seats.map((item:any)=>[item.id,item.name]),[['Player 1','Alice'],['Player 2','Bobby']]);
 const restored=HostSession.fromRecovery(()=>{},()=>{},()=>String(++serial).padStart(43,'a'),()=>0,checkpoint);
 assert.deepEqual(restored.lobby().map(seat=>[seat.id,seat.name]),[['Player 1','Alice'],['Player 2','Bobby']]);
 assert.equal(seat.id,'Player 2');
});


for(const count of [5,6])test(`expanded room starts with ${count} connected ready players and advertises its board version`,()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession(
  (peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),
  value=>published.push(value),
  ()=>String(++serial).padStart(43,'a'),
  ()=>0,
  {boardLayout:'expanded-5-6'},
 );
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 for(let i=2;i<=count;i++){send(`p${i}`,{type:'hello'});send(`p${i}`,{type:'ready',ready:true});}
 assert.equal(host.lobby().length,count);
 host.setHostReady(true);host.start(71);
 const snapshot=published.filter(x=>x.type==='snapshot').at(-1).data;
 assert.equal(snapshot.public.players.length,count);
 assert.equal(snapshot.public.board.layout,'expanded-5-6');
 assert.equal(snapshot.public.board.hexes.length,24);
 assert.equal(snapshot.public.board.hexes.filter((hex:any)=>hex.terrain==='desert').length,2);
 const lobby=published.filter(x=>x.type==='lobby').at(-1).lobby;
 assert.equal(lobby.boardLayout,'expanded-5-6');
});

test('expanded room admits six seats and rejects a seventh before start',()=>{
 const messages=new Map<string,any[]>();let serial=0;
 const host=new HostSession(
  (peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),
  ()=>{},
  ()=>String(++serial).padStart(43,'a'),
  ()=>0,
  {boardLayout:'expanded-5-6'},
 );
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 for(let i=2;i<=6;i++)send(`p${i}`,{type:'hello'});
 assert.equal(host.lobby().length,6);
 send('p7',{type:'hello'});
 assert.equal(messages.get('p7')!.some(x=>x.type==='spectator'),true);
 assert.equal(host.lobby().length,6);
});

test('expanded room cannot start until it has at least five players',()=>{
 let serial=0;
 const host=new HostSession(()=>{},()=>{},()=>String(++serial).padStart(43,'a'),()=>0,{boardLayout:'expanded-5-6'});
 const send=(id:string,message:object)=>host.receive(id,JSON.stringify({protocol:1,...message}));
 for(let i=2;i<=4;i++){send(`p${i}`,{type:'hello'});send(`p${i}`,{type:'ready',ready:true});}
 host.setHostReady(true);
 assert.throws(()=>host.start(1),/Five to six/);
});

test('host selects map and seed inside the lobby and every player sees the selection',()=>{
 const messages=new Map<string,any[]>();let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),()=>{},()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('p2',{type:'hello'});send('p2',{type:'ready',ready:true});host.setHostReady(true);
 host.setMapSelection('expanded-5-6',24680);
 assert.equal(host.lobby().every(s=>!s.ready),true);
 const lobby=messages.get('p2')!.filter(x=>x.type==='lobby').at(-1).data;
 assert.equal(lobby.boardLayout,'expanded-5-6');assert.equal(lobby.mapSeed,24680);
 send('p2',{type:'map',boardLayout:'standard',mapSeed:42});
 assert.equal(messages.get('p2')!.filter(x=>x.type==='lobby').at(-1).data.mapSeed,24680);
 for(let i=3;i<=5;i++){send('p'+i,{type:'hello'});send('p'+i,{type:'ready',ready:true});}
 send('p2',{type:'ready',ready:true});host.setHostReady(true);host.start(24680);
 assert.equal(host.recovery().authority.state.board.layout,'expanded-5-6');
 assert.equal(host.recovery().authority.state.board.seed,24680);
 assert.throws(()=>host.setMapSelection('standard',1),/only available before/);
});
test('guests toggle between spectator and player in lobby without losing other seats',()=>{
 const messages=new Map<string,any[]>();let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),()=>{},()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('a',{type:'hello'});const a=messages.get('a')!.find(x=>x.type==='seat').data;
 send('b',{type:'hello',role:'spectator'});
 assert.equal(host.spectatorCount(),1);assert.equal(host.lobby().length,2);
 send('a',{type:'role',role:'spectator'});
 assert.equal(host.spectatorCount(),2);assert.equal(host.lobby().length,1);
 send('b',{type:'role',role:'player',name:'Bob'});
 assert.equal(host.spectatorCount(),1);
 const next=messages.get('b')!.find(x=>x.type==='seat').data;
 assert.equal(next.id,'Player 2');assert.notEqual(next.token,a.token);
 send('attacker',{type:'hello',token:a.token});assert.equal(messages.get('attacker')!.at(-1).type,'error');
 send('a',{type:'role',role:'player',name:'Alice'});assert.equal(host.lobby().length,3);
 send('b',{type:'ready',ready:true});send('a',{type:'ready',ready:true});host.setHostReady(true);
 host.start(11);
 send('a',{type:'role',role:'spectator'});assert.equal(host.lobby().length,3);
 assert.equal(messages.get('a')!.filter(x=>x.type==='snapshot').at(-1).data.private!==null,true);
});
test('host restarts the current game in same room with fresh identity and spectator sync',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession((peer,text)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('p2',{type:'hello'});const seat=messages.get('p2')!.find(x=>x.type==='seat').data;
 send('p2',{type:'ready',ready:true});host.setHostReady(true);host.start(31);
 const before=host.recovery().authority.gameId;
 send('spectator',{type:'hello'});const watcher=messages.get('spectator')!.find(x=>x.type==='snapshot').data;assert.equal(watcher.private,null);
 assert.equal(host.submit({type:'place-settlement',vertexId:createIslandBoard().vertices[0].id},'first-move',0).ok,true);
 host.restart();
 const checkpoint=host.recovery();
 assert.notEqual(checkpoint.authority.gameId,before);
 assert.equal(checkpoint.authority.revision,0);assert.equal(checkpoint.authority.state.phase,'setup-settlement');
 assert.equal(checkpoint.authority.state.board.seed,31);assert.equal(checkpoint.seats[1].token,seat.token);
 const replay=messages.get('p2')!.filter(x=>x.type==='restart').at(-1);
 assert.equal(replay.data.gameId,checkpoint.authority.gameId);
 assert.equal(messages.get('spectator')!.filter(x=>x.type==='snapshot').at(-1).data.private,null);
 assert.equal(published.filter(x=>x.type==='checkpoint').at(-1).replace,true);
 assert.equal(host.submit({type:'place-settlement',vertexId:createIslandBoard().vertices[0].id},'second-move',0).ok,true);
});

test('host abort returns to map selection with the original seats and spectator privacy',()=>{
 const outgoing=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession((peer,text)=>outgoing.set(peer,[...(outgoing.get(peer)??[]),JSON.parse(text)]),x=>published.push(x),()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(peer:string,command:object)=>host.receive(peer,JSON.stringify({protocol:1,...command}));
 send('friend',{type:'hello'});const credential=outgoing.get('friend')!.find(x=>x.type==='seat').data.token;
 send('friend',{type:'ready',ready:true});host.setHostReady(true);host.start(23);
 send('viewer',{type:'hello'});assert.equal(host.spectatorCount(),1);
 const old=host.recovery().authority.gameId;
 host.abortToSetup();
 assert.throws(()=>host.recovery(),/not started/);
 assert.throws(()=>host.restart(),/No running game/);
 assert.equal(host.lobby().length,2);assert.equal(host.spectatorCount(),1);
 assert.ok(host.lobby().every(s=>!s.ready));
 assert.equal(outgoing.get('friend')!.at(-2).type,'abort');
 assert.equal(outgoing.get('viewer')!.at(-2).type,'abort');
 assert.equal(published.filter(x=>x.type==='checkpoint-clear').length,1);
 assert.equal(published.filter(x=>x.type==='abort').length,1);
 host.setGameMode('harbor-coop');host.setMapSelection('standard',44);
 send('friend',{type:'map',boardLayout:'expanded-5-6',mapSeed:999});
 const lobby=outgoing.get('friend')!.filter(x=>x.type==='lobby').at(-1).data;
 assert.equal(lobby.mode,'harbor-coop');assert.equal(lobby.mapSeed,44);assert.equal(lobby.started,false);
 assert.throws(()=>host.start(44),/ready players/);
 send('friend',{type:'ready',ready:true});host.setHostReady(true);host.start(44);
 assert.equal(host.recovery().authority.state.mode,'harbor-coop');
 assert.equal(host.recovery().authority.state.board.seed,44);
 assert.notEqual(host.recovery().authority.gameId,old);
 assert.equal(host.recovery().seats[1].token,credential);
 assert.equal(outgoing.get('viewer')!.filter(x=>x.type==='snapshot').at(-1).data.private,null);
});

test('seven discards do not broadcast a refreshed game until all players submit',()=>{
 const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const output=(peer:string,text:string)=>messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]);
 const token=()=>String(++serial).padStart(43,'a');
 const send=(room:HostSession,peer:string,message:object)=>room.receive(peer,JSON.stringify({protocol:1,...message}));
 const started=new HostSession(output,value=>published.push(value),token,()=>0);
 send(started,'b-peer',{type:'hello'});send(started,'c-peer',{type:'hello'});
 const bToken=messages.get('b-peer')!.find(m=>m.type==='seat').data.token;
 const cToken=messages.get('c-peer')!.find(m=>m.type==='seat').data.token;
 send(started,'b-peer',{type:'ready',ready:true});send(started,'c-peer',{type:'ready',ready:true});
 started.setHostReady(true);started.start(44);
 const saved=started.recovery();
 saved.authority.state.phase='discard';saved.authority.state.currentSeat=0;
 saved.authority.state.discards={'Player 2':4,'Player 3':4};
 // The synthetic discard state needs matching independent clock participants.
 saved.authority.clock={paused:false,remaining:{'Player 2':45_000,'Player 3':45_000}};
 saved.authority.state.players[1].hand.lumber=8;
 saved.authority.state.players[2].hand.brick=8;
 saved.authority.state.bank.lumber-=8;saved.authority.state.bank.brick-=8;
 const room=HostSession.fromRecovery(output,value=>published.push(value),token,()=>0,saved);
 send(room,'b-new',{type:'hello',token:bToken});send(room,'c-new',{type:'hello',token:cToken});room.resume(saved);
 const revision=saved.authority.revision,gameId=saved.authority.gameId;
 const sendDiscard=(peer:string,playerId:string,id:string,cards:object)=>
  send(room,peer,{type:'command',command:JSON.stringify({protocol:1,gameId,revision,commandId:id,sender:playerId,command:{type:'discard',playerId,cards}})});
 const b={lumber:4,brick:0,wool:0,grain:0,ore:0},c={lumber:0,brick:4,wool:0,grain:0,ore:0};
 const snapshots=(peer:string)=>messages.get(peer)!.filter(m=>m.type==='snapshot').length;
 const startB=snapshots('b-new'),startC=snapshots('c-new'),startPublic=published.filter(m=>m.type==='snapshot').length;
 sendDiscard('b-new','Player 2','submit-b',b);
 assert.equal(snapshots('b-new'),startB);assert.equal(snapshots('c-new'),startC);
 assert.equal(published.filter(m=>m.type==='snapshot').length,startPublic);
 assert.equal(messages.get('b-new')!.filter(m=>m.type==='discard-pending').at(-1).type,'discard-pending');
 assert.equal(room.recovery().authority.revision,revision);
 assert.equal(room.recovery().authority.pendingDiscards?.['Player 2'].lumber,4);
 assert.equal(room.recovery().authority.state.players[1].hand.lumber,8);
 send(room,'b-new',{type:'sync'});
 assert.equal(messages.get('b-new')!.filter(m=>m.type==='discard-pending').at(-1).type,'discard-pending');
 sendDiscard('c-new','Player 3','submit-c',c);
 assert.equal(snapshots('c-new'),startC+1);assert.equal(snapshots('b-new'),startB+2);
 assert.equal(published.filter(m=>m.type==='snapshot').length,startPublic+1);
 assert.equal(room.recovery().authority.revision,revision+1);
 assert.equal(room.recovery().authority.state.phase,'robber');
 assert.equal(room.recovery().authority.state.players[1].hand.lumber,4);
 assert.equal(room.recovery().authority.state.players[2].hand.brick,4);
});

test('Twin Capes room synchronizes the board, seat range and mandatory ships across restarts and recovery',()=>{
 for(const count of [2,3,4,5,6]){
  const messages=new Map<string,any[]>(),published:any[]=[];let serial=0;
  const send=(peer:string,text:string)=>{messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(text)]);};
  const token=()=>String(++serial).padStart(43,'x');
  const host=new HostSession(send,event=>published.push(event),token,()=>0);
  const heard=(peer:string,kind:string)=>messages.get(peer)?.filter(row=>row.type===kind).at(-1)?.data;
  host.setMapSelection('twin-capes',42);host.setOptionalRules({catchUp:true,ships:false});
  for(let i=2;i<=count;i++)host.receive('p'+i,JSON.stringify({protocol:1,type:'hello'}));
  host.receive('watch',JSON.stringify({protocol:1,type:'hello',role:'spectator'}));
  assert.equal(heard('watch','lobby').boardLayout,'twin-capes');
  assert.deepEqual(heard('p2','lobby').rules,{catchUp:true,ships:true});
  if(count===6){host.receive('extra',JSON.stringify({protocol:1,type:'hello'}));assert.equal(host.lobby().length,6);}
  for(let i=2;i<=count;i++)host.receive('p'+i,JSON.stringify({protocol:1,type:'ready',ready:true}));
  host.setHostReady(true);host.start(42);
  const first=heard('watch','snapshot');assert.equal(first.private,null);assert.equal(first.public.players.length,count);
  assert.equal(first.public.board.layout,'twin-capes');assert.ok(first.public.board.piratePortEdgeId);
  host.restart();
  const next=heard('p2','snapshot');assert.notEqual(next.gameId,first.gameId);assert.deepEqual(next.public.board,first.public.board);
  const saved=host.recovery();assert.equal(saved.mainlandShips,false);assert.equal(saved.boardLayout,'twin-capes');
  const restored=HostSession.fromRecovery(send,event=>published.push(event),token,()=>0,saved);
  assert.equal(restored.isRecovering(),true);assert.deepEqual(restored.recovery().authority.state.board,next.public.board);
  host.abortToSetup();
  host.setMapSelection(count>4?'expanded-5-6':'standard',42);
  assert.deepEqual(heard('p2','lobby').rules,{catchUp:true,ships:false});
 }
});

test('an original Twin Capes checkpoint resumes its 29 land tiles and restarts on the new 25-tile board',()=>{
 const seed=107,old=generateBoardSetup(seed,'twin-capes',GENERATOR_VERSION);
 assert.equal(old.hexes.length,29);assert.equal(old.version,GENERATOR_VERSION);
 const game=createGame(seed,['Player 1','Player 2'],()=>0,{boardLayout:'twin-capes'});
 game.board=old;game.phase='pirate';game.currentSeat=0;game.turn=3;game.resumePhase='action';
 const port=old.ports.find(p=>p.edgeId!==old.piratePortEdgeId)!;
 game.buildings[port.vertexIds[0]]={playerId:'Player 2',kind:'settlement'};game.players[1].hand.grain=2;
 const saved:SessionRecovery={version:1,qaTwoPlayers:false,boardLayout:'twin-capes',authority:{version:1,gameId:'legacy-twin',revision:12,state:game},seats:[{id:'Player 1',token:''},{id:'Player 2',token:'w'.repeat(43)}]};
 const corrupt=structuredClone(saved);corrupt.authority.state.board.version=TWIN_CAPES_VERSION;
 assert.throws(()=>parseSessionRecovery(corrupt),/Twin Capes map/);
 const spurious=structuredClone(saved);spurious.authority.state.phase='steal';spurious.authority.state.victims=['Player 2'];
 assert.throws(()=>parseSessionRecovery(spurious),/legacy pirate harbor/);
 const messages=new Map<string,any[]>();let serial=0;
 const send=(peer:string,message:string)=>{messages.set(peer,[...(messages.get(peer)??[]),JSON.parse(message)]);};
 const host=HostSession.fromRecovery(send,()=>{},()=>String(++serial).padStart(43,'q'),()=>0,JSON.parse(JSON.stringify(saved)));
 const last=(kind:string)=>messages.get('guest')?.filter(m=>m.type===kind).at(-1)?.data;
 host.receive('guest',JSON.stringify({protocol:1,type:'hello',token:saved.seats[1].token}));
 assert.equal(last('lobby').mapVersion,GENERATOR_VERSION);
 const other=structuredClone(saved);other.authority.state.board=generateBoardSetup(seed,'twin-capes');other.authority.state.phase='robber';other.authority.state.buildings={};
 assert.throws(()=>host.resume(other),/board does not belong/);
 host.resume(saved);
 assert.deepEqual(last('snapshot').public.board,old);assert.deepEqual(last('snapshot').public.buildings,game.buildings);
 assert.equal(host.submit({type:'move-pirate',edgeId:port.edgeId},'close',12).ok,true);
 assert.equal(last('snapshot').public.phase,'action','the original edition has no pirate theft');
 assert.equal(last('snapshot').private.hand.grain,2);
 host.restart();
 assert.equal(last('lobby').mapVersion,TWIN_CAPES_VERSION);assert.equal(last('snapshot').public.board.version,TWIN_CAPES_VERSION);
 assert.equal(last('snapshot').public.board.hexes.length,25);assert.equal(host.recovery().boardLayout,'twin-capes');
});

test('remote dice deliver exact private resources and public per-seat counts to the roller, phones and spectators after sync',()=>{
 const ids=['Player 1','Player 2','Player 3','Player 4'],seed=71;
 const game=createGame(seed,ids,()=>0,{boardLayout:'twin-capes'});game.turn=4;game.phase='roll';game.currentSeat=1;
 const geometry=createIslandBoard(game.board.layout,game.board.version);
 const tile=game.board.hexes.find(tile=>tile.token!==null&&tile.resource!==null&&tile.hexId!==game.board.robberHexId)!;
 const home=geometry.hexes.find(hex=>hex.id===tile.hexId)!;const total=tile.token!,resource=tile.resource!;
 game.buildings[home.vertexIds[0]]={playerId:ids[0],kind:'settlement'};
 game.buildings[home.vertexIds[2]]={playerId:ids[1],kind:'settlement'};
 game.buildings[home.vertexIds[4]]={playerId:ids[2],kind:'city'};
 game.players[2].hand.wool=2;game.bank.wool-=2;
 const expected=game.players.map(p=>({...p.hand}));
 const gains:Record<string,number>=Object.fromEntries(ids.map(id=>[id,0]));
 for (const hex of geometry.hexes) {
  const producing=game.board.hexes.find(cell=>cell.hexId===hex.id)!;
  if(producing.token!==total||!producing.resource||producing.hexId===game.board.robberHexId)continue;
  for(const vertex of hex.vertexIds){
   const building=game.buildings[vertex];if(!building)continue;
   const count=building.kind==='city'?2:1;
   expected[ids.indexOf(building.playerId)][producing.resource]+=count;gains[building.playerId]+=count;
  }
 }
 assert.ok(expected[2][resource]>=game.players[2].hand[resource]+2);
 const messages=new Map<string,any[]>(),published:any[]=[];
 const saved:SessionRecovery={version:1,qaTwoPlayers:false,boardLayout:'twin-capes',authority:{version:1,gameId:'phone-yield',revision:3,state:game},
  seats:ids.map((id,i)=>({id,token:i?String(i).repeat(43):''}))};
 const dice:[number,number]=[Math.min(total-1,6),total-Math.min(total-1,6)];
 const entropy=dice.map(d=>d-1);
 const room=HostSession.fromRecovery((id,text)=>messages.set(id,[...(messages.get(id)??[]),JSON.parse(text)]),
  value=>published.push(value),()=>'v'.repeat(43),()=>entropy.shift()??0,saved);
 const receive=(peer:string,data:object)=>room.receive(peer,JSON.stringify({protocol:1,...data}));
 const join=(peer:string,index:number)=>receive(peer,{type:'hello',token:saved.seats[index].token});
 const snapshot=(peer:string)=>messages.get(peer)!.filter(m=>m.type==='snapshot').at(-1).data;
 join('roller',1);join('phone',2);join('idle',3);receive('watch',{type:'hello',role:'spectator'});room.resume(saved);
 const roll=JSON.stringify({protocol:1,gameId:'phone-yield',revision:3,commandId:'actual-roll',sender:ids[1],command:{type:'roll',playerId:ids[1]}});
 receive('roller',{type:'command',command:roll});
 const host=published.filter(m=>m.type==='snapshot').at(-1).data;
 const receipt={turn:4,dice,playerId:ids[1],gains};assert.equal(gains[ids[3]],0);
 for(const [i,view] of [host,snapshot('roller'),snapshot('phone'),snapshot('idle')].entries()){
  assert.equal(view.revision,4);assert.deepEqual(view.private.hand,expected[i]);
  assert.deepEqual(view.public.lastRollPayout,receipt);assert.ok(view.public.players.every((p:{hand?:unknown})=>!('hand' in p)));
 }
 const spectator=snapshot('watch');assert.deepEqual(spectator.public.lastRollPayout,receipt);assert.equal(spectator.private,null);
 receive('roller',{type:'command',command:roll});assert.equal(room.recovery().authority.revision,4);
 room.disconnect('phone');
 const end=JSON.stringify({protocol:1,gameId:'phone-yield',revision:4,commandId:'end',sender:ids[1],command:{type:'end-turn',playerId:ids[1]}});
 receive('roller',{type:'command',command:end});join('phone-returned',2);
 const rejoined=snapshot('phone-returned');assert.equal(rejoined.public.turn,5);assert.equal(rejoined.public.dice,null);
 assert.deepEqual(rejoined.private.hand,expected[2]);assert.deepEqual(rejoined.public.lastRollPayout,receipt);
 receive('phone-returned',{type:'sync'});
 assert.deepEqual(snapshot('phone-returned'),rejoined,'repeat sync does not credit a second hand or create a new roll event');
 assert.deepEqual(parseSessionRecovery(room.recovery()).authority.state.lastRollPayout,receipt);
 const invalid=room.recovery();invalid.authority.state.lastRollPayout!.gains[ids[0]]=-1;
 assert.throws(()=>parseSessionRecovery(invalid),/roll payout/);
});
