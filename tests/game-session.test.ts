import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/game/network/session.ts';

for(const count of [3,4])test(`${count}-player lobby starts, projects private state and restores a guest seat`,()=>{
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
