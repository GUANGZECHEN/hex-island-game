import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRoomMusicFrame, isRoomMusicMessage, ROOM_MUSIC_BASE64_LENGTH, ROOM_MUSIC_FRAME_SAMPLES,
  ROOM_MUSIC_SAMPLE_RATE, RoomMusicGuest, RoomMusicHost,
} from '../src/game/network/room-music.ts';

const sample = 'A'.repeat(ROOM_MUSIC_BASE64_LENGTH);
const wire = (action: string, generation: number, fields: Record<string, unknown> = {}) =>
  ({ protocol: 1, type: 'room-music', action, generation, ...fields });

function hostHarness() {
  const sent: { peer: string; text: string; message: ReturnType<typeof JSON.parse>; frame: boolean }[] = [];
  const listeners: boolean[] = [];
  const host = new RoomMusicHost((peer, text, frame) => {
    sent.push({ peer, text, message: JSON.parse(text), frame: !!frame });
  }, listening => listeners.push(listening));
  return { host, sent, listeners };
}
function guestHarness(initialListening = true) {
  const controls: ReturnType<typeof JSON.parse>[] = [], offers: boolean[] = [], frames: number[] = [], events: string[] = [];
  const guest = new RoomMusicGuest(text => { controls.push(JSON.parse(text)); }, {
    availability(available) { offers.push(available); events.push('available:' + available); },
    frame(data, seq) { assert.equal(data, sample); frames.push(seq); events.push('frame'); },
    reset() { events.push('reset'); },
  }, initialListening);
  return { guest, controls, offers, frames, events };
}

test('live music wire format fits one bounded relay message and rejects malformed base64', () => {
  assert.equal(ROOM_MUSIC_FRAME_SAMPLES / ROOM_MUSIC_SAMPLE_RATE, .15);
  assert.equal(Buffer.from(sample,'base64').length, ROOM_MUSIC_FRAME_SAMPLES);
  for (const invalid of [null, undefined, 1, '', sample + 'A', sample.slice(1), sample.slice(1) + '=',
    sample.slice(1) + '\n', sample.slice(1) + 'ü', sample.slice(1) + '-']) assert.equal(isRoomMusicFrame(invalid),false);
  assert.ok(isRoomMusicFrame('+//A'.repeat(1200)));
  const { host, sent } = hostHarness();
  host.setSharing(true); host.admit('spectator');
  const generation = sent.at(-1)!.message.generation;
  host.receive('spectator',wire('listen',generation,{subscription: 1, enabled: true}));
  host.frame(sample);
  const frame = sent.at(-1)!;
  assert.ok(frame.frame);
  assert.ok(Buffer.byteLength(frame.text) < 16_384);
  assert.deepEqual(frame.message, wire('frame',generation,{subscription:1, sequence:1, data:sample}));
  assert.ok(isRoomMusicMessage({ type:'room-music', protocol:999 }));
  assert.equal(isRoomMusicMessage({type:'command'}),false);
});

test('only an admitted, listening peer receives media and no client can publish or enable the host', () => {
  const { host, sent, listeners } = hostHarness();
  host.admit('seat'); host.admit('seat'); host.admit('observer');
  assert.equal(sent.length,2); assert.ok(sent.every(item => !item.message.enabled && !item.frame));
  host.setSharing(true);
  const gen=sent.at(-1)!.message.generation;
  for (const msg of [wire('listen',gen-1,{subscription:1,enabled:true}), wire('listen',gen,{subscription:-1,enabled:true}),
    wire('listen',gen,{subscription:1,enabled:'yes'}),wire('offer',gen,{enabled:true}),wire('frame',gen,{subscription:1,sequence:1,data:sample}),
    {...wire('listen',gen,{subscription:1,enabled:true}),extra:true}]) host.receive('seat',msg);
  host.receive('unadmitted',wire('listen',gen,{subscription:1,enabled:true}));
  host.frame(sample); assert.equal(host.hasListeners,false); assert.equal(sent.filter(item=>item.frame).length,0);
  host.receive('observer',wire('listen',gen,{subscription:1,enabled:true}));
  host.frame(sample); assert.deepEqual(sent.filter(item=>item.frame).map(item=>item.peer),['observer']);
  host.remove('observer'); host.frame(sample);
  assert.equal(sent.filter(item=>item.frame).length,1); assert.deepEqual(listeners,[true,false]);
  host.setSharing(false); host.frame(sample); assert.equal(sent.at(-1)!.message.enabled,false);
});

test('a stalled listener has at most six unacknowledged frames and resumes at the live sequence', () => {
  const {host,sent} = hostHarness();
  host.setSharing(true); host.admit('slow'); host.admit('fast');
  const gen=sent.at(-1)!.message.generation;
  for(const id of ['slow','fast']) host.receive(id,wire('listen',gen,{enabled:true,subscription:1}));
  for(let n=1;n<=11;n++){
    host.frame(sample);
    host.receive('fast',wire('ack',gen,{subscription:1,sequence:n}));
  }
  const seqs=(peer:string)=>sent.filter(item=>item.frame&&item.peer===peer).map(item=>item.message.sequence);
  assert.deepEqual(seqs('slow'),[1,2,3,4,5,6]); assert.equal(seqs('fast').length,11);
  for(const [subscription,sequence] of [[2,4],[1,99],[1,-1],[1,3.1]]) host.receive('slow',wire('ack',gen,{subscription,sequence}));
  host.frame(sample); assert.equal(seqs('slow').length,6);
  host.receive('slow',wire('ack',gen,{subscription:1,sequence:6}));
  host.frame(sample); assert.deepEqual(seqs('slow'),[1,2,3,4,5,6,13]);
});

test('backpressured frame sends are dropped without using ACK slots or interfering with control messages', () => {
  let blocked=true, delivered=0;
  const sent: ReturnType<typeof JSON.parse>[]=[];
  const host=new RoomMusicHost((_id,text,isFrame)=>{
    if(isFrame && blocked)return false;
    if(isFrame)delivered++;
    sent.push(JSON.parse(text));
  });
  host.admit('a');host.setSharing(true);
  const gen=sent.at(-1).generation;
  host.receive('a',wire('listen',gen,{subscription:1,enabled:true}));
  for(let n=0;n<15;n++)host.frame(sample);
  blocked=false;host.frame(sample);
  assert.equal(delivered,1);assert.equal(sent.at(-1).sequence,16);
  host.reset();assert.equal(sent.at(-1).enabled,false);
  host.setSharing(true);host.frame(sample);assert.equal(delivered,1);
});

test('late join, mute, resubscribe and generation transitions discard stale media and acknowledgements', () => {
  const {guest,controls,offers,frames,events}=guestHarness();
  const frame=(generation:number,subscription:number,sequence:number)=>wire('frame',generation,{subscription,sequence,data:sample});
  guest.receive(frame(7,1,40));assert.deepEqual(frames,[]);
  guest.receive(wire('offer',7,{enabled:true}));
  assert.deepEqual(controls,[wire('listen',7,{subscription:1,enabled:true})]);
  assert.deepEqual(events,['reset','available:true']);
  guest.receive(frame(7,1,41));guest.receive(frame(7,1,41));guest.receive(frame(7,1,38));
  assert.deepEqual(frames,[41]);assert.deepEqual(controls.at(-1),wire('ack',7,{subscription:1,sequence:41}));
  guest.setListening(false);guest.receive(frame(7,1,42));assert.deepEqual(frames,[41]);
  guest.setListening(true);guest.receive(frame(7,1,43));guest.receive(frame(7,3,44));
  assert.deepEqual(frames,[41,44]);
  guest.receive(wire('offer',8,{enabled:false}));guest.receive(frame(7,3,45));guest.receive(wire('offer',7,{enabled:true}));
  guest.receive(wire('offer',8,{enabled:true}));assert.deepEqual(offers,[true,false]);
  guest.receive(wire('offer',9,{enabled:true}));guest.receive(frame(9,1,1));
  assert.deepEqual(frames,[41,44,1]);assert.deepEqual(offers,[true,false,true]);
  assert.equal(controls.filter(message=>message.action==='ack').length,3);
});

test('wire reset clears pending playback and retains this guest’s preference when reconnecting', () => {
  const {guest,offers,frames,controls}=guestHarness(false);
  guest.receive(wire('offer',4,{enabled:true}));assert.equal(controls.at(-1).enabled,false);
  guest.receive(wire('frame',4,{subscription:1,sequence:6,data:sample}));assert.deepEqual(frames,[]);
  guest.reset();guest.receive(wire('offer',1,{enabled:true}));assert.deepEqual(offers,[true,false,true]);
  assert.equal(controls.at(-1).enabled,false);
  guest.setListening(true);
  for(const invalid of [
    wire('frame',1,{subscription:2,sequence:0,data:sample}), wire('frame',1,{subscription:2,sequence:NaN,data:sample}),
    wire('frame',1,{subscription:2,sequence:1,data:sample.slice(1)}), wire('ack',1,{subscription:2,sequence:1}),
    {...wire('frame',1,{subscription:2,sequence:1,data:sample}),extra:true},
    {...wire('frame',1,{subscription:2,sequence:1,data:sample}),protocol:999},
  ])guest.receive(invalid);
  assert.deepEqual(frames,[]);assert.equal(controls.some(msg=>msg.action==='ack'),false);
  guest.receive(wire('frame',1,{subscription:2,sequence:5,data:sample}));assert.deepEqual(frames,[5]);
});
