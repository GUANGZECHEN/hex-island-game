import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { RoomMusicCapture } from '../src/game/ui/room-music-capture.ts';

const workletSource = readFileSync(new URL('../src/game/ui/room-music-worklet.js', import.meta.url), 'utf8');
type Packet = { generation: number; bytes: ArrayBuffer; endTime: number };
type Port = { onmessage: (event: { data: { active: boolean; generation: number } }) => void };
type Processor = { port: Port; process: (inputs: Float32Array[][]) => boolean };

function worklet(rate: number) {
  const packets: Packet[] = [];
  let processor: Processor;
  class AudioWorkletProcessor {
    port = {
      postMessage(packet: Packet, transfer: ArrayBuffer[]) {
        assert.equal(transfer[0], packet.bytes);
        packets.push(packet);
      },
    };
  }
  const scope = {
    sampleRate: rate, currentTime: 0, AudioWorkletProcessor,
    registerProcessor(name: string, registered: new () => Processor) {
      assert.equal(name, 'hex-room-music');
      processor = new registered();
    },
  };
  runInNewContext(workletSource, scope);
  let elapsedSamples = 0;
  return {
    packets,
    active(value: boolean, generation: number) {
      processor.port.onmessage({ data: { active: value, generation } });
    },
    feed(samples: number, signal: number | ((index: number) => number)) {
      for (let remaining = samples; remaining > 0;) {
        const count = Math.min(remaining, 128);
        scope.currentTime = elapsedSamples / rate;
        const block = new Float32Array(count);
        if (typeof signal === 'number') block.fill(signal);
        else for (let i = 0; i < count; i++) block[i] = signal(elapsedSamples + i);
        processor.process([[block]]);
        elapsedSamples += count;
        remaining -= count;
      }
    },
  };
}

test('worklet emits one 3600-byte mono µ-law packet per 150 ms at supported input rates', () => {
  for (const rate of [8000, 24000, 44100, 48000, 96000]) {
    const capture = worklet(rate);
    capture.active(true, 1);
    const period = rate * .15;
    capture.feed(period - 1, 0);
    assert.equal(capture.packets.length, 0);
    capture.feed(1, 0);
    capture.feed(period, 1);
    capture.feed(period, -1);
    assert.equal(capture.packets.length, 3);
    const expectedCodes = [0xff, 0x80, 0x00];
    for (const [index, packet] of capture.packets.entries()) {
      assert.equal(packet.bytes.byteLength, 3600);
      assert.equal(packet.generation, 1);
      assert.ok(new Uint8Array(packet.bytes).every(value => value === expectedCodes[index]));
      assert.ok(Math.abs(packet.endTime - (index + 1) * .15) < 1e-9);
    }
  }
});

test('inactive worklet discards partial audio and starts the next listener with a fresh packet', () => {
  const rate = 48000;
  const capture = worklet(rate);
  capture.feed(rate, 1);
  capture.active(true, 1);
  capture.feed(rate * .1, -1);
  capture.active(false, 2);
  capture.feed(rate, -1);
  assert.equal(capture.packets.length, 0);
  capture.active(true, 3);
  capture.feed(rate * .15 - 1, 1);
  assert.equal(capture.packets.length, 0);
  capture.feed(1, 1);
  assert.equal(capture.packets.length, 1);
  assert.equal(capture.packets[0].generation, 3);
  assert.ok(new Uint8Array(capture.packets[0].bytes).every(value => value === 0x80));
});

test('downsampling integrates both input samples at 48 kHz', () => {
  const capture = worklet(48000);
  capture.active(true, 1);
  capture.feed(7200, index => index % 2 === 0 ? 1 : -1);
  assert.equal(capture.packets.length, 1);
  assert.ok(new Uint8Array(capture.packets[0].bytes).every(value => value === 0xff));
});

async function captureBrowser(t: TestContext) {
  const ownerDocument = Object.assign(new EventTarget(), { hidden: false });
  const audio = Object.assign(new EventTarget(), {
    ownerDocument, src: 'blob:track-a', paused: false, ended: false, seeking: false,
    readyState: 4, loop: false, duration: 30, currentTime: 5, playbackRate: 1,
  });
  const node = { connect() {}, disconnect() {} };
  const context = Object.assign(new EventTarget(), {
    destination: {}, state: 'running', currentTime: 10,
    audioWorklet: { async addModule() {} },
    createMediaElementSource: () => node,
    async resume() { context.state = 'running'; context.dispatchEvent(new Event('statechange')); },
  });
  let generation = 0;
  const port = {
    postMessage(message: { generation: number }) { generation = message.generation; },
    onmessage: (_event: { data: Packet }) => {},
  };
  const replacements = {
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_NOTHING: 0 },
    AudioContext: function (options: AudioContextOptions) {
      assert.equal(options.latencyHint, 'playback');
      return context;
    },
    AudioWorkletNode: function () { return { ...node, port }; },
  };
  for (const [name, value] of Object.entries(replacements)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, name, old);
      else Reflect.deleteProperty(globalThis, name);
    });
  }

  const received: number[] = [];
  let boundaries = 0;
  const capture = new RoomMusicCapture(audio as unknown as HTMLAudioElement,
    data => received.push(atob(data).charCodeAt(0)), () => boundaries++);
  capture.setStreaming(true);
  await capture.enable();
  const packet = (id: number, age: number, sourceGeneration = generation) => {
    const bytes = new Uint8Array(3600);
    bytes[0] = id;
    port.onmessage({ data: { bytes: bytes.buffer, endTime: context.currentTime - age, generation: sourceGeneration } });
  };
  t.after(() => capture.disable());
  return { audio, ownerDocument, context, capture, received, packet, generation: () => generation, boundaries: () => boundaries };
}

test('the host delivers recent worklet packets after a UI stall and recovers an interrupted audio context', async t => {
  const { audio, ownerDocument, context, received, packet, generation, boundaries } = await captureBrowser(t);
  // Six consecutive complete packets arrive together after a 750 ms host stall.
  for (let id = 0; id < 6; id++) packet(id, (5 - id) * .15);
  assert.deepEqual(received, [0, 1, 2, 3, 4, 5]);
  packet(6, 2.4);
  assert.equal(received.length, 6, 'discard obsolete audio after a longer sleep');

  const interruptedGeneration = generation();
  ownerDocument.hidden = true;
  context.state = 'suspended';
  context.dispatchEvent(new Event('statechange'));
  ownerDocument.dispatchEvent(new Event('visibilitychange'));
  assert.equal(context.state, 'suspended');
  ownerDocument.hidden = false;
  ownerDocument.dispatchEvent(new Event('visibilitychange'));
  assert.equal(context.state, 'running');
  packet(7, .01, interruptedGeneration);
  packet(8, .01);
  assert.deepEqual(received, [0, 1, 2, 3, 4, 5, 8], 'an interrupted stream cannot leak stale frames into the resumed stream');
  audio.paused = true;
  context.state = 'suspended';
  ownerDocument.dispatchEvent(new Event('visibilitychange'));
  assert.equal(context.state, 'suspended', 'foregrounding must not resume paused music');
  assert.equal(boundaries(), 0, 'system interruption alone does not erase queued guest audio');
});

test('host flushes audible music once for intentional boundaries and ignores obsolete media events', async t => {
  const { audio, context, received, packet, boundaries, generation, capture } = await captureBrowser(t);
  packet(0, 0);
  audio.readyState = 2;
  audio.dispatchEvent(new Event('waiting'));
  audio.readyState = 4;
  audio.dispatchEvent(new Event('playing'));
  assert.equal(boundaries(), 0);
  packet(1, .01);
  audio.paused = true;
  audio.dispatchEvent(new Event('pause'));
  audio.dispatchEvent(new Event('pause'));
  assert.equal(boundaries(), 1);

  audio.paused = false;
  audio.dispatchEvent(new Event('playing'));
  packet(2, 0);
  const oldTrack = generation();
  audio.src = 'blob:track-b';
  audio.dispatchEvent(new Event('loadstart'));
  audio.dispatchEvent(new Event('playing'));
  packet(3, .01, oldTrack);
  packet(4, .01);
  for (const type of ['pause', 'seeking', 'emptied', 'ended', 'waiting']) audio.dispatchEvent(new Event(type));
  assert.equal(boundaries(), 2);
  assert.deepEqual(received, [0, 1, 2, 4]);

  audio.loop = true;
  audio.currentTime = 29.9;
  packet(5, 0);
  context.currentTime += .1;
  audio.currentTime = 0;
  audio.seeking = true;
  const beforeLoop = generation();
  audio.dispatchEvent(new Event('seeking'));
  audio.seeking = false;
  audio.dispatchEvent(new Event('seeked'));
  assert.equal(generation(), beforeLoop, 'automatic looping keeps the contiguous stream');
  assert.equal(boundaries(), 2);
  packet(6, 0);

  audio.currentTime = 8;
  audio.seeking = true;
  audio.dispatchEvent(new Event('seeking'));
  audio.seeking = false;
  audio.dispatchEvent(new Event('seeked'));
  assert.equal(boundaries(), 3);
  packet(7, .01);
  capture.setStreaming(false);
  capture.setStreaming(true);
  assert.equal(boundaries(), 3, 'listener demand is independent of host playback boundaries');
});
