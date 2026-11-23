import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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
