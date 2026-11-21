import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=(await readFile(new URL('../src/index.ts',import.meta.url),'utf8')).replace("from './protocol'",`from '${new URL('../src/protocol.ts',import.meta.url).href}'`);
const { Room }=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
import { hash, parseHeartbeat } from '../src/protocol.ts';

class Socket {
  attachment: any = null; messages: any[] = []; closed: any = null;
  deserializeAttachment() { return this.attachment; }
  serializeAttachment(value: any) { this.attachment=value; }
  send(value: string) { this.messages.push(JSON.parse(value)); }
  close(code: number, reason: string) { this.closed={code,reason}; }
}
const hostToken='H'.repeat(43), guestToken='G'.repeat(43);
async function setup() {
  const info={hostHash:await hash(hostToken),guestHash:await hash(guestToken),expires:Date.now()+60000};
  const values=new Map<string,any>([['info',info],['checkpoint:latest',{data:'preserve'}]]);
  const sockets:Socket[]=[]; let writes=0;
  const state={storage:{get:async(key:string)=>values.get(key),put:async()=>{writes++;},delete:async()=>{writes++;}},getWebSockets:()=>sockets,blockConcurrencyWhile:async(fn:()=>Promise<void>)=>fn()};
  return {room:new Room(state as any),sockets,values,getWrites:()=>writes,info};
}
async function authenticate(room:any,socket:Socket,role:'host'|'guest') {
  await room.webSocketMessage(socket as any,JSON.stringify({type:'auth',role,token:role==='host'?hostToken:guestToken}));
}
test('heartbeat shape accepts only exact nonnegative safe integer IDs',()=>{
  for(const id of [0,1,Number.MAX_SAFE_INTEGER]) assert.deepEqual(parseHeartbeat(JSON.stringify({id,type:'ping'})),{type:'ping',id});
  for(const message of ['null','[]','{',JSON.stringify({type:'ping'}),...[-1,1.5,Number.MAX_SAFE_INTEGER+1,'1',null].map(id=>JSON.stringify({type:'ping',id})),JSON.stringify({type:'ping',id:1,extra:true})]) assert.equal(parseHeartbeat(message),null);
});
test('authenticated host and guest heartbeats respond locally without storage changes',async()=>{
  const {room,sockets,values,getWrites,info}=await setup();
  const host=new Socket(),guest=new Socket();sockets.push(host,guest);
  await authenticate(room,host,'host');await authenticate(room,guest,'guest');
  assert.equal(host.messages[0].heartbeat,true);assert.equal(guest.messages[0].heartbeat,true);
  host.messages=[];guest.messages=[];
  await room.webSocketMessage(host as any,JSON.stringify({type:'ping',id:0}));
  await room.webSocketMessage(guest as any,JSON.stringify({type:'ping',id:42}));
  assert.deepEqual(host.messages,[{type:'pong',id:0}]);assert.deepEqual(guest.messages,[{type:'pong',id:42}]);
  assert.equal(getWrites(),0);assert.deepEqual(values.get('checkpoint:latest'),{data:'preserve'});assert.equal(values.get('info'),info);
});
test('preauth, malformed, oversized and expired heartbeats are rejected',async()=>{
  const {room,sockets,info}=await setup();
  const unauth=new Socket();sockets.push(unauth);
  await room.webSocketMessage(unauth as any,JSON.stringify({type:'ping',id:1}));
  assert.deepEqual(unauth.closed,{code:1008,reason:'invalid'});
  for(const message of [JSON.stringify({type:'ping',id:-1}),JSON.stringify({type:'ping',id:1,extra:true}),JSON.stringify({type:'ping',id:'1'}),'x'.repeat(65537)]){
    const socket=new Socket();socket.attachment={id:'host',role:'host'};sockets.push(socket);
    await room.webSocketMessage(socket as any,message);
    assert.deepEqual(socket.closed,{code:1008,reason:'invalid'});assert.deepEqual(socket.messages,[]);
  }
  info.expires=Date.now()-1;
  const expired=new Socket();expired.attachment={id:'host',role:'host'};sockets.push(expired);
  await room.webSocketMessage(expired as any,JSON.stringify({type:'ping',id:1}));
  assert.deepEqual(expired.closed,{code:1008,reason:'expired'});assert.deepEqual(expired.messages,[]);
});

test('host close acknowledges the handshake, closes guests and permits only a subsequent host',async()=>{
  const {room,sockets}=await setup();
  const host=new Socket(),guest1=new Socket(),guest2=new Socket();sockets.push(host,guest1,guest2);
  await authenticate(room,host,'host');await authenticate(room,guest1,'guest');await authenticate(room,guest2,'guest');
  const competing=new Socket();sockets.push(competing);
  await authenticate(room,competing,'host');
  assert.deepEqual(competing.messages,[{type:'error',code:'host-unavailable'}]);
  await room.webSocketClose(host,4000,'qa-reconnect');
  assert.deepEqual(host.closed,{code:4000,reason:'qa-reconnect'});
  assert.equal(host.attachment,null);
  for(const guest of [guest1,guest2]){
    assert.deepEqual(guest.messages.at(-1),{type:'error',code:'host-unavailable'});
    assert.deepEqual(guest.closed,{code:1000,reason:'host-unavailable'});
  }
  const replacement=new Socket();sockets.push(replacement);
  await authenticate(room,replacement,'host');
  assert.equal(replacement.messages[0].type,'ready');
});

test('reserved close codes are not echoed and repeated close cleans up only once',async()=>{
  const {room,sockets}=await setup();
  const host=new Socket(),guest=new Socket();sockets.push(host,guest);
  await authenticate(room,host,'host');await authenticate(room,guest,'guest');
  await room.webSocketClose(host,1006,'');
  assert.deepEqual(host.closed,{code:undefined,reason:undefined});
  const count=guest.messages.length;
  await room.webSocketClose(host,1006,'');
  assert.equal(guest.messages.length,count);
});
