import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { smokeSignaling } from '../signaling/scripts/smoke.mjs';
const room='A'.repeat(43),host='B'.repeat(43),guest='C'.repeat(43),secret='sensitive-canary';
const valid=()=>({room,host,guest,expires:Date.now()+60000});
class GoodSocket extends EventEmitter {
 readyState=1;
 constructor(_url:string,options:any){super();assert.equal(options.headers.Origin,'https://guangzechen.github.io');queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"authenticate"}'),false));}
 send(payload:string){const auth=JSON.parse(payload);assert.equal(auth.role,'host');assert.equal(auth.token,host);queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"ready","role":"host","id":"host"}'),false));}
 close(){this.readyState=3;} terminate(){this.readyState=3;}
}
class BadSocket extends EventEmitter {
 readyState=0;
 constructor(){super();queueMicrotask(()=>this.emit('error',new Error(secret)));}
 terminate(){this.readyState=3;} close(){this.readyState=3;}
}
test('smoke creates a room using the production Origin and authenticates a host',async()=>{
 const fetcher=async (_url:any,options:any)=>{assert.equal(options.method,'POST');assert.equal(options.headers.Origin,'https://guangzechen.github.io');assert.equal(options.headers['Content-Type'],'application/json');return new Response(JSON.stringify(valid()),{status:201});};
 await smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:fetcher,Socket:GoodSocket});
});
test('smoke reports HTTP failures with fixed safe errors and rejects malformed room data',async()=>{
 const run=(body:any,status:number)=>smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>new Response(JSON.stringify(body),{status}),Socket:GoodSocket});
 await assert.rejects(run({error:'creation-failed'},500),/HTTP 500, creation-failed/);
 await assert.rejects(run({error:secret},500),error=>String(error).includes('HTTP 500')&&!String(error).includes(secret));
 for(const body of [{...valid(),host:[host]},{...valid(),expires:0},{...valid(),room:secret},null])await assert.rejects(run(body,201),/invalid response/);
 await assert.rejects(smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>{throw Error(secret);}}),error=>String(error).includes('unreachable')&&!String(error).includes(secret));
});
test('smoke sanitizes WebSocket and authentication failures',async()=>{
 await assert.rejects(smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>new Response(JSON.stringify(valid()),{status:201}),Socket:BadSocket}),error=>String(error).includes('WebSocket')&&!String(error).includes(secret));
});
test('host authentication rejection is sanitized',async()=>{
 class RejectSocket extends EventEmitter {
  readyState=1;
  constructor(){super();queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"authenticate"}'),false));}
  send(){queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'error',code:secret})),false));}
  close(){this.readyState=3;} terminate(){this.readyState=3;}
 }
 await assert.rejects(smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>new Response(JSON.stringify(valid()),{status:201}),Socket:RejectSocket}),error=>String(error).includes('WebSocket')&&!String(error).includes(secret));
});
test('a temporarily unavailable route is retried within a fixed limit',async()=>{
 let attempts=0,retries=0;
 await smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>{attempts++;return attempts===1?new Response('not found',{status:404}):new Response(JSON.stringify(valid()),{status:201});},Socket:GoodSocket,retries:1,retryDelayMs:0,onRetry:()=>retries++});
 assert.equal(attempts,2);assert.equal(retries,1);
 attempts=0;await assert.rejects(smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>{attempts++;return new Response('not found',{status:404});},Socket:GoodSocket,retries:2,retryDelayMs:0}),/HTTP 404/);assert.equal(attempts,3);
});
