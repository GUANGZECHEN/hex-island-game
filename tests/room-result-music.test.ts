import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomResultMusic } from '../src/game/ui/room-result-music.ts';

test('opposite ending sends only current encoded audio; the host speakers receive no opposite music', async t => {
  class Node {
    links:unknown[]=[]; disconnected=false;
    connect(target:unknown){this.links.push(target);}
    disconnect(){this.disconnected=true;}
  }
  class Source extends Node {
    offset={value:1}; gain={value:1}; buffer:unknown; onended:(()=>void)|null=null;
    started=false; stopped=false; offsetSeconds=0;
    start(_when=0,offsetSeconds=0){this.started=true;this.offsetSeconds=offsetSeconds;}
    stop(){this.stopped=true;}
  }
  const encoders:Encoder[]=[];
  class Encoder extends Node {
    port={onmessage:null as ((message:{data:{bytes:ArrayBuffer;endTime:number;generation:number}})=>void)|null,
      postMessage:({generation}:{generation:number})=>{this.generation=generation;},close:()=>{}};
    generation=0;
    constructor(){super();encoders.push(this);}
  }
  const old=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode');
  Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:Encoder});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'AudioWorkletNode',old);else Reflect.deleteProperty(globalThis,'AudioWorkletNode');});
  const destination={}, sources:Source[]=[], tails:Source[]=[], gains:Source[]=[];
  let now=1;
  const context={get currentTime(){return now;},state:'running',destination,decodeAudioData:async()=>({duration:.05}),
    createBufferSource:()=>{const src=new Source();sources.push(src);return src;},
    createConstantSource:()=>{const src=new Source();tails.push(src);return src;},
    createGain:()=>{const gain=new Source();gains.push(gain);return gain;},
  } as unknown as AudioContext;
  const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
  const received:string[]=[];
  let resets=0;
  const audio=new RoomResultMusic(frame=>received.push(frame),()=>{resets++;});
  const win=new File(['clip'],'m01017.wav'),loss=new File(['other'],'m01018.wav');
  audio.update(context,win,'g1',true);await tick();assert.equal(sources.length,0,'respect an already-muted host');
  audio.update(context,win,'g1');audio.update(context,loss,'g1');
  await tick();
  assert.equal(encoders.length,1,'the superseded decode cannot play');
  assert.equal(sources.length,1);
  assert.deepEqual(sources[0].links,[gains[0]]);assert.deepEqual(tails[0].links,[gains[0]]);
  assert.deepEqual(gains[0].links,[encoders[0]]);assert.deepEqual(encoders[0].links,[destination]);
  assert.equal(sources[0].started,true);assert.equal(tails[0].started,true);
  const send=encoders[0].port.onmessage!;
  const packet={data:{generation:encoders[0].generation,endTime:1,bytes:new ArrayBuffer(3600)}};
  send(packet);assert.equal(received.length,1);
  now+=.02;audio.update(context,loss,'g1',true);
  assert.equal(resets,1,'pause flushes scheduled guest sound');assert.equal(sources[0].stopped,true);
  send(packet);assert.equal(received.length,1,'queued worklet packets cannot leak past mute');
  audio.update(context,loss,'g1');await tick();assert.equal(encoders.length,2);
  assert.ok(Math.abs(sources[1].offsetSeconds-.02)<1e-7,'resume the opposite cue at the paused position');
  tails[1].onended!();
  audio.update(context,loss,'g1',true);audio.update(context,loss,'g1');await tick();assert.equal(encoders.length,2,'neither render nor unmute replays a finished result');
  audio.update(null,null,'g1');send(packet);assert.equal(received.length,1,'unsubscribing invalidates delayed frames');
});
