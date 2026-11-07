import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { hash } from '../src/protocol.ts';

const ORIGIN='https://guangzechen.github.io';
const oldCreator='A'.repeat(43);
const newCreator='B'.repeat(43);

function environment(storedHash:string|undefined){
 const inits:Array<Record<string,unknown>>=[];
 let lookups=0;
 const env:any={
  CREATOR_CAPABILITY_HASH:storedHash,
  ROOMS:{
   idFromName(name:string){lookups++;return name;},
   get(){return {fetch:async(_url:string,init?:RequestInit)=>{inits.push(JSON.parse(String(init?.body??'{}')));return Response.json({ok:true});}};},
  },
 };
 return {env,inits,lookups:()=>lookups};
}

function request(capability?:string,method='POST'){
 const headers:Record<string,string>={Origin:ORIGIN};
 if(capability)headers.Authorization=`Bearer ${capability}`;
 return new Request('https://worker.example/rooms',{method,headers});
}

test('room creation fails closed before Durable Object allocation without the current creator capability',async()=>{
 const stored=await hash(oldCreator);
 for(const capability of [undefined,'short',newCreator]){
  const {env,lookups}=environment(stored);
  const response=await worker.fetch(request(capability),env);
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:'unauthorized'});
  assert.equal(lookups(),0);
 }
 const missing=environment(undefined);
 assert.equal((await worker.fetch(request(oldCreator),missing.env)).status,401);
 assert.equal(missing.lookups(),0);
});

test('current creator capability can create a room without entering creator authority into the Durable Object',async()=>{
 const {env,inits}=environment(await hash(oldCreator));
 const response=await worker.fetch(request(oldCreator),env);
 assert.equal(response.status,201);
 assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
 const body:any=await response.json();
 assert.match(body.room,/^[A-Za-z0-9_-]{43}$/);
 assert.match(body.host,/^[A-Za-z0-9_-]{43}$/);
 assert.match(body.guest,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(inits.length,1);
 assert.deepEqual(Object.keys(inits[0]).sort(),['expires','guestHash','hostHash']);
 assert.equal(JSON.stringify(inits[0]).includes(oldCreator),false);
});

test('manual rotation rejects the old creator for new rooms while existing room initialization stays independent',async()=>{
 const holder=environment(await hash(oldCreator));
 const first=await worker.fetch(request(oldCreator),holder.env);
 assert.equal(first.status,201);
 const firstInit=structuredClone(holder.inits[0]);

 holder.env.CREATOR_CAPABILITY_HASH=await hash(newCreator);
 assert.equal((await worker.fetch(request(oldCreator),holder.env)).status,401);
 assert.equal((await worker.fetch(request(newCreator),holder.env)).status,201);
 assert.deepEqual(holder.inits[0],firstInit);
 assert.deepEqual(Object.keys(firstInit).sort(),['expires','guestHash','hostHash']);
});

test('CORS preflight explicitly permits the Authorization header used for creator capability',async()=>{
 const {env}=environment(await hash(oldCreator));
 const response=await worker.fetch(new Request('https://worker.example/rooms',{
  method:'OPTIONS',
  headers:{Origin:ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},
 }),env);
 assert.equal(response.status,204);
 const allowed=(response.headers.get('access-control-allow-headers')??'').toLowerCase();
 assert.ok(allowed.includes('authorization'));
 assert.ok(allowed.includes('content-type'));
});
