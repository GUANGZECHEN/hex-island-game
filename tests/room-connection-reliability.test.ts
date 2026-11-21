import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir=await mkdtemp(join(tmpdir(),'room-reliability-'));
const entry=join(dir,'entry.ts'),bundle=join(dir,'bundle.mjs');
await writeFile(entry,`export {RoomClient} from ${JSON.stringify(new URL('../src/rooms.ts',import.meta.url).pathname)}; export {HostSession} from ${JSON.stringify(new URL('../src/game/network/session.ts',import.meta.url).pathname)};`);
await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {RoomClient,HostSession}=await import(pathToFileURL(bundle).href);
await rm(dir,{recursive:true,force:true});

class Clock {
 now=0; next=0; jobs=new Map<number,{at:number,fn:()=>void}>();
 setTimeout=(fn:()=>void,delay:number)=>{const id=++this.next;this.jobs.set(id,{at:this.now+delay,fn});return id;};
 clearTimeout=(id:number)=>{this.jobs.delete(id);};
 advance(ms:number){const end=this.now+ms;for(;;){const next=[...this.jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;this.now=next[1].at;this.jobs.delete(next[0]);next[1].fn();}this.now=end;}
}
class Target { listeners=new Map<string,Set<()=>void>>(); addEventListener=(name:string,fn:()=>void)=>{if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name)!.add(fn);}; removeEventListener=(name:string,fn:()=>void)=>this.listeners.get(name)?.delete(fn); fire(name:string){for(const fn of this.listeners.get(name)??[])fn();} }
class Socket {
 static OPEN=1;static instances:Socket[]=[];readyState=1;sent:any[]=[];onmessage:any;onclose:any;onerror:any;
 constructor(_url:URL){Socket.instances.push(this);}
 send(text:string){this.sent.push(JSON.parse(text));} close(){this.readyState=3;}
 message(value:object){this.onmessage?.({data:JSON.stringify(value)});} drop(){this.readyState=3;this.onclose?.({});}
}
const setup=()=>{
 const clock=new Clock(),windowTarget=new Target(),documentTarget=Object.assign(new Target(),{visibilityState:'visible'});
 Object.assign(globalThis,{WebSocket:Socket,window:Object.assign(windowTarget,clock),document:documentTarget,location:{href:'https://example.test/'},fetch:async()=>({ok:true,json:async()=>({room:'r'.repeat(43),host:'h'.repeat(43),guest:'g'.repeat(43)})})});
 Socket.instances=[];return {clock,windowTarget,documentTarget};
};
const events=()=>({status:()=>{},error:()=>{},peer:()=>{},remove:()=>{},message:()=>{}});
const create=async(client:any,heartbeat=true)=>{const promise=client.create();await new Promise(resolve=>setImmediate(resolve));const ws=Socket.instances.at(-1)!;ws.message({type:'authenticate'});ws.message({type:'ready',heartbeat});await promise;return ws;};

test('actual host session disconnects every guest and reconnects even if callbacks throw',async()=>{
 for(const count of [1,2,5]){
  const {clock}=setup();let host:any,serial=0,throwPublish=false;
  const client=new RoomClient(['https://relay.test'],{...events(),remove:(id:string)=>host.disconnect(id),removeMany:(ids:string[])=>host.disconnectMany(ids),message:(id:string,text:string)=>host.receive(id,text)});
  host=new HostSession((id:string,text:string)=>client.send(id,text),()=>{if(throwPublish)throw Error('callback');},()=>String(++serial).padStart(43,'a'),()=>0,{boardLayout:count===5?'expanded-5-6':'standard'});
  const ws=await create(client);
  for(let i=1;i<=count;i++){const id=`guest${i}`;ws.message({type:'join',id});ws.message({type:'relay',from:id,data:JSON.stringify({protocol:1,type:'hello'})});}
  assert.equal(host.lobby().filter((x:any)=>x.connected).length,count+1);
  throwPublish=true;assert.doesNotThrow(()=>ws.drop());assert.ok(host.lobby().slice(1).every((x:any)=>!x.connected));
  clock.advance(500);assert.equal(Socket.instances.length,2);throwPublish=false;client.reset();
 }
});

test('heartbeat detects half-open sockets, honors advertised capability and ignores stale events',async()=>{
 const {clock}=setup();let messages=0;const client=new RoomClient(['https://relay.test'],{...events(),message:()=>messages++});
 const ws=await create(client);clock.advance(25000);assert.deepEqual(ws.sent.at(-1),{type:'ping',id:0});ws.message({type:'pong',id:0});clock.advance(25000);assert.deepEqual(ws.sent.at(-1),{type:'ping',id:1});clock.advance(20000);clock.advance(500);assert.equal(Socket.instances.length,2);
 ws.message({type:'relay',from:'guest1',data:'old'});assert.equal(messages,0);client.reset();clock.advance(100000);assert.equal(Socket.instances.length,2);
 const legacy=new RoomClient(['https://relay.test'],events());const old=await create(legacy,false);clock.advance(100000);assert.equal(old.sent.some((x:any)=>x.type==='ping'),false);legacy.reset();
});

test('handshake timeout, error without close, and wake recovery clean up timers and listeners',async()=>{
 const {clock,windowTarget,documentTarget}=setup();const client=new RoomClient(['https://relay.test'],events());
 const first=client.restoreHost('r'.repeat(43),'h'.repeat(43));clock.advance(15000);await assert.rejects(first);assert.equal(Socket.instances[0].readyState,3);
 const ws=await create(client);documentTarget.visibilityState='hidden';clock.advance(70000);assert.equal(ws.readyState,1);documentTarget.visibilityState='visible';documentTarget.fire('visibilitychange');assert.equal(ws.sent.at(-1).type,'ping');clock.advance(20000);assert.equal(ws.readyState,3);windowTarget.fire('online');clock.advance(0);assert.equal(Socket.instances.length,3);
 const next=Socket.instances.at(-1)!;next.onerror();await Promise.resolve();client.reset();clock.advance(100000);assert.equal(Socket.instances.length,3);assert.equal(clock.jobs.size,0);assert.equal(windowTarget.listeners.get('online')?.size,0);
});

test('three-player reconnection preserves seat credentials and heartbeat does not refresh the game clock',async()=>{
 const {clock}=setup();let host:any,serial=0;
 const client=new RoomClient(['https://relay.test'],{...events(),removeMany:(ids:string[])=>host.disconnectMany(ids),message:(id:string,text:string)=>host.receive(id,text)});
 host=new HostSession((id:string,text:string)=>client.send(id,text),()=>{},()=>String(++serial).padStart(43,'a'),()=>0,{qaTwoPlayers:true});
 const ws=await create(client);const credentials:string[]=[];
 for(const id of ['first','second']){
  ws.message({type:'join',id});ws.message({type:'relay',from:id,data:JSON.stringify({protocol:1,type:'hello'})});
  const seat=ws.sent.filter((x:any)=>x.type==='relay'&&x.to===id).map((x:any)=>JSON.parse(x.data)).find((x:any)=>x.type==='seat');credentials.push(seat.data.token);
  ws.message({type:'relay',from:id,data:JSON.stringify({protocol:1,type:'ready',ready:true})});
 }
 host.setHostReady(true);host.start(1);const before=host.recovery().authority;
 clock.advance(25000);ws.message({type:'pong',id:0});const afterPing=host.recovery().authority;assert.equal(afterPing.revision,before.revision);assert.deepEqual(afterPing.state,before.state);assert.ok(afterPing.clock.remaining['Player 1']<=before.clock.remaining['Player 1']);
 ws.drop();assert.ok(host.lobby().slice(1).every((s:any)=>!s.connected));clock.advance(500);
 const recovered=Socket.instances.at(-1)!;recovered.message({type:'authenticate'});recovered.message({type:'ready',heartbeat:true});
 for(let i=0;i<2;i++){
  const id=`new${i}`;recovered.message({type:'join',id});recovered.message({type:'relay',from:id,data:JSON.stringify({protocol:1,type:'hello',token:credentials[i]})});
 }
 assert.ok(host.lobby().every((s:any)=>s.connected));const afterReconnect=host.recovery().authority;assert.equal(afterReconnect.revision,before.revision);assert.deepEqual(afterReconnect.state,before.state);assert.ok(afterReconnect.clock.remaining['Player 1']<=afterPing.clock.remaining['Player 1']);client.reset();
});

test('reset cancels a pending room creation even if fetch ignores abort',async()=>{
 setup();Object.assign(globalThis,{fetch:()=>new Promise(()=>{})});const client=new RoomClient(['https://relay.test'],events());
 const creating=client.create();client.reset();await assert.rejects(creating,/cancelled/);assert.equal(Socket.instances.length,0);
});

test('background heartbeats continue and an old pong after wake is harmless',async()=>{
 const {clock,documentTarget,windowTarget}=setup();const client=new RoomClient(['https://relay.test'],events());const ws=await create(client);
 documentTarget.visibilityState='hidden';clock.advance(25000);assert.deepEqual(ws.sent.at(-1),{type:'ping',id:0});
 documentTarget.visibilityState='visible';windowTarget.fire('pageshow');assert.deepEqual(ws.sent.at(-1),{type:'ping',id:1});
 ws.message({type:'pong',id:0});assert.equal(ws.readyState,1);ws.message({type:'pong',id:1});clock.advance(25000);assert.deepEqual(ws.sent.at(-1),{type:'ping',id:2});client.reset();
});

test('reset during initial join prevents old endpoint retries and late callbacks',async()=>{
 const {clock}=setup();const statuses:string[]=[];const client=new RoomClient(['https://one.test','https://two.test'],{...events(),status:(s:string)=>statuses.push(s)});
 const joining=client.join('r'.repeat(43),'g'.repeat(43));const old=Socket.instances[0];client.reset();await assert.rejects(joining,/cancelled/);old.message({type:'ready',heartbeat:true});old.onerror();clock.advance(100000);
 assert.equal(Socket.instances.length,1);assert.equal(clock.jobs.size,0);assert.equal(statuses.length,1);
});

test('callback errors are reported safely and cannot strand authentication or recovery',async()=>{
 const {clock}=setup();let errors=0,removals=0;
 const client=new RoomClient(['https://relay.test'],{...events(),peer:()=>{throw Error('private');},remove:()=>{removals++;throw Error('private');},error:(s:string)=>{errors++;assert.equal(s,'A room connection update could not be displayed.');}});
 const promise=client.join('r'.repeat(43),'g'.repeat(43));const ws=Socket.instances[0];ws.message({type:'ready',heartbeat:true});await promise;assert.equal(errors,1);ws.drop();assert.equal(removals,1);assert.equal(errors,2);clock.advance(500);assert.equal(Socket.instances.length,2);client.reset();
});
