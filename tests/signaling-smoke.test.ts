import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { smokeSignaling } from '../signaling/scripts/smoke.mjs';

const room='A'.repeat(43),host='B'.repeat(43),guest='C'.repeat(43),guestId='D'.repeat(43),secret='sensitive-canary';
const valid=()=>({room,host,guest,expires:Date.now()+60000});
const cors={'Access-Control-Allow-Origin':'https://guangzechen.github.io'};
const preflight=()=>new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
const ok=()=>new Response(JSON.stringify(valid()),{status:201,headers:cors});

class GoodSocket extends EventEmitter {
  static sockets:GoodSocket[]=[];
  readyState=1;
  role:'host'|'guest'|null=null;
  checkpointLatest:any=null;
  checkpointHistory:any[]=[];

  constructor(_url:string,options:any){
    super();
    assert.equal(options.headers.Origin,'https://guangzechen.github.io');
    GoodSocket.sockets.push(this);
    queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"authenticate"}'),false));
  }

  send(payload:string){
    const message=JSON.parse(payload);
    if(message.type==='auth'){
      this.role=message.role;
      assert.equal(message.token,message.role==='host'?host:guest);
      const ready={type:'ready',role:message.role,id:message.role==='host'?'host':guestId};
      queueMicrotask(()=>{
        this.emit('message',Buffer.from(JSON.stringify(ready)),false);
        if(message.role==='guest'){
          const hostSocket=GoodSocket.sockets.find(x=>x.role==='host');
          hostSocket?.emit('message',Buffer.from(JSON.stringify({type:'join',id:guestId})),false);
        }
      });
      return;
    }

    if(message.type==='relay'){
      if(this.role==='guest'){
        assert.equal(message.to,'host');
        const target=GoodSocket.sockets.find(x=>x.role==='host');
        queueMicrotask(()=>target?.emit('message',Buffer.from(JSON.stringify({type:'relay',from:guestId,data:message.data})),false));
      }else{
        assert.equal(message.to,guestId);
        const target=GoodSocket.sockets.find(x=>x.role==='guest');
        queueMicrotask(()=>target?.emit('message',Buffer.from(JSON.stringify({type:'relay',from:'host',data:message.data})),false));
      }
      return;
    }
    if(this.role==='host'&&message.type==='checkpoint-save'){
      if(this.checkpointLatest&&this.checkpointLatest.round>0&&this.checkpointLatest.round!==message.round){
        this.checkpointHistory=[this.checkpointLatest,...this.checkpointHistory.filter(x=>x.round!==this.checkpointLatest.round&&x.round!==message.round)].slice(0,3);
      }else this.checkpointHistory=this.checkpointHistory.filter(x=>x.round!==message.round);
      this.checkpointLatest={id:`cp_mock_${message.revision}_${message.round}`,revision:message.revision,round:message.round,savedAt:Date.now(),data:message.data};
      const {data,...meta}=this.checkpointLatest;
      queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'checkpoint-saved',checkpoint:{...meta,latest:true}})),false));
      return;
    }
    if(this.role==='host'&&message.type==='checkpoint-list'){
      const meta=(x:any,latest:boolean)=>{const {data,...rest}=x;return {...rest,latest};};
      const checkpoints=[...(this.checkpointLatest?[meta(this.checkpointLatest,true)]:[]),...this.checkpointHistory.map(x=>meta(x,false))];
      queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'checkpoint-list',checkpoints})),false));
      return;
    }
    if(this.role==='host'&&message.type==='checkpoint-load'){
      const checkpoint=[...(this.checkpointLatest?[this.checkpointLatest]:[]),...this.checkpointHistory].find(x=>x.id===message.id);
      queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'checkpoint-data',checkpoint})),false));
    }
  }

  close(){this.readyState=3;}
  terminate(){this.readyState=3;}
}

class BadSocket extends EventEmitter {
  readyState=0;
  constructor(){super();queueMicrotask(()=>this.emit('error',new Error(secret)));}
  terminate(){this.readyState=3;}
  close(){this.readyState=3;}
}

test('smoke creates a room, authenticates host+guest and relays both directions',async()=>{
  GoodSocket.sockets=[];
  const fetcher=async (_url:any,options:any)=>{
    assert.equal(options.headers.Origin,'https://guangzechen.github.io');
    if(options.method==='OPTIONS'){
      assert.equal(options.headers['Access-Control-Request-Method'],'POST');
      assert.equal(options.headers['Access-Control-Request-Headers'],'content-type');
      return preflight();
    }
    assert.equal(options.method,'POST');
    assert.equal(options.headers['Content-Type'],'application/json');
    return ok();
  };
  await smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:fetcher,Socket:GoodSocket});
});

test('smoke reports HTTP failures with fixed safe errors and rejects malformed room data',async()=>{
  const run=(body:any,status:number)=>smokeSignaling(
    'https://hex-island-signaling.example.workers.dev',
    {fetchImpl:async()=>new Response(JSON.stringify(body),{status}),Socket:GoodSocket},
  );
  await assert.rejects(run({error:'creation-failed'},500),/HTTP 500, creation-failed/);
  await assert.rejects(run({error:secret},500),error=>String(error).includes('HTTP 500')&&!String(error).includes(secret));
  for(const body of [{...valid(),host:[host]},{...valid(),expires:0},{...valid(),room:secret},null]){
    await assert.rejects(run(body,201),/invalid response/);
  }
  await assert.rejects(
    smokeSignaling('https://hex-island-signaling.example.workers.dev',{fetchImpl:async()=>{throw Error(secret);}}),
    error=>String(error).includes('unreachable')&&!String(error).includes(secret),
  );
});

test('smoke sanitizes WebSocket and authentication failures',async()=>{
  await assert.rejects(
    smokeSignaling(
      'https://hex-island-signaling.example.workers.dev',
      {fetchImpl:async(_url:any,options:any)=>options.method==='OPTIONS'?preflight():ok(),Socket:BadSocket},
    ),
    error=>String(error).includes('WebSocket')&&!String(error).includes(secret),
  );
});

test('a temporarily unavailable route is retried within a fixed limit',async()=>{
  GoodSocket.sockets=[];
  let attempts=0,retries=0;
  await smokeSignaling(
    'https://hex-island-signaling.example.workers.dev',
    {
      fetchImpl:async(_url:any,options:any)=>{
        if(options.method==='OPTIONS')return preflight();
        attempts++;
        return attempts===1?new Response('not found',{status:404}):ok();
      },
      Socket:GoodSocket,
      retries:1,
      retryDelayMs:0,
      onRetry:()=>retries++,
    },
  );
  assert.equal(attempts,2);
  assert.equal(retries,1);

  attempts=0;
  await assert.rejects(
    smokeSignaling(
      'https://hex-island-signaling.example.workers.dev',
      {
        fetchImpl:async()=>{attempts++;return new Response('not found',{status:404});},
        Socket:GoodSocket,
        retries:2,
        retryDelayMs:0,
      },
    ),
    /HTTP 404/,
  );
  assert.equal(attempts,3);
});

test('missing CORS permissions block browser deployment without disclosing response data',async()=>{
  await assert.rejects(
    smokeSignaling(
      'https://hex-island-signaling.example.workers.dev',
      {fetchImpl:async()=>new Response(JSON.stringify(valid()),{status:201}),Socket:GoodSocket},
    ),
    /CORS response/,
  );
  await assert.rejects(
    smokeSignaling(
      'https://hex-island-signaling.example.workers.dev',
      {
        fetchImpl:async(_url:any,options:any)=>options.method==='OPTIONS'
          ?new Response(null,{status:204,headers:cors})
          :ok(),
        Socket:GoodSocket,
      },
    ),
    /CORS preflight/,
  );
});
