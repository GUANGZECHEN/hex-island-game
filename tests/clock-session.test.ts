import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/game/network/session.ts';

test('only host controls pause, checkpoint and reconnect preserve it',()=>{
 const sent=new Map<string,any[]>(),published:any[]=[];let serial=0;
 const host=new HostSession((peer,text)=>sent.set(peer,[...(sent.get(peer)??[]),JSON.parse(text)]),event=>published.push(event),()=>String(++serial).padStart(43,'a'),()=>0);
 const send=(peer:string,message:object)=>host.receive(peer,JSON.stringify({protocol:1,...message}));
 send('guest',{type:'hello'});const credential=sent.get('guest')!.find(e=>e.type==='seat').data.token;
 send('guest',{type:'ready',ready:true});host.setHostReady(true);host.start(7);
 send('guest',{type:'pause',paused:true});send('observer',{type:'hello',role:'spectator'});send('observer',{type:'pause',paused:true});assert.equal(host.recovery().authority.clock?.paused,false);
 assert.equal(host.setPaused(true),true);
 assert.equal(published.filter(e=>e.type==='checkpoint').at(-1).replace,true);assert.equal(published.filter(e=>e.type==='checkpoint').at(-1).revision,0);
 assert.equal(published.filter(e=>e.type==='snapshot').at(-1).data.public.paused,true);
 assert.equal(host.submit({type:'roll'},'blocked',0).code,'paused');
 host.disconnect('guest');send('reconnected',{type:'hello',token:credential});
 assert.equal(sent.get('reconnected')!.find(e=>e.type==='snapshot').data.public.paused,true);
 assert.equal(sent.get('reconnected')!.find(e=>e.type==='clock').data.paused,true);send('reconnected',{type:'sync'});assert.equal(sent.get('reconnected')!.filter(e=>e.type==='snapshot').at(-1).data.public.paused,true);
 const checkpoint=host.recovery();
 const restored=HostSession.fromRecovery(()=>{},()=>{},()=>String(++serial).padStart(43,'a'),()=>0,checkpoint);
 assert.equal(restored.recovery().authority.clock?.paused,true);
 assert.equal(host.setPaused(false),true);assert.equal(host.recovery().authority.clock?.paused,false);
});

test('saved clock rejects invalid remaining time and old saves remain readable',()=>{
 const events:any[]=[];let serial=0;
 const host=new HostSession(()=>{},event=>events.push(event),()=>String(++serial).padStart(43,'a'),()=>0);
 host.receive('guest',JSON.stringify({protocol:1,type:'hello'}));host.receive('guest',JSON.stringify({protocol:1,type:'ready',ready:true}));host.setHostReady(true);host.start(5);
 const saved=host.recovery(),old=structuredClone(saved);delete old.authority.clock;
 assert.doesNotThrow(()=>HostSession.fromRecovery(()=>{},()=>{},()=>'',()=>0,old));
 const bad=structuredClone(saved);bad.authority.clock!.remaining[Object.keys(bad.authority.clock!.remaining)[0]]=45_001;
 assert.throws(()=>HostSession.fromRecovery(()=>{},()=>{},()=>'',()=>0,bad),/Invalid saved clock/);
});
