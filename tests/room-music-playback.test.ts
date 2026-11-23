import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomMusicPlayback, type RoomMusicPlaybackStatus } from '../src/game/ui/room-music-playback.ts';
import { ROOM_MUSIC_FRAME_SAMPLES, ROOM_MUSIC_SAMPLE_RATE } from '../src/game/network/room-music.ts';

const pattern = btoa(String.fromCharCode(0, 255, 128, 127).repeat(ROOM_MUSIC_FRAME_SAMPLES / 4));

class FakeSource {
  buffer: { getChannelData(): Float32Array } | null = null;
  output: object | null = null;
  onended: (() => void) | null = null;
  startAt = -1;
  stopped = false;
  connect(output: object) { this.output = output; }
  start(at: number) { this.startAt = at; }
  stop() { this.stopped = true; }
  disconnect() { this.output = null; }
  end() { this.onended?.(); }
}

class FakeContext extends EventTarget {
  state = 'suspended';
  currentTime = 0;
  allowed = true;
  resumeCalls = 0;
  destination = {};
  gain = { gain: { value: 1 }, connect: (dest: object) => assert.equal(dest, this.destination), disconnect() {} };
  sources: FakeSource[] = [];
  createGain() { return this.gain; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  createBuffer(channels: number, frames: number, rate: number) {
    assert.equal(channels, 1); assert.equal(frames, ROOM_MUSIC_FRAME_SAMPLES); assert.equal(rate, ROOM_MUSIC_SAMPLE_RATE);
    const samples = new Float32Array(frames);
    return { getChannelData: () => samples };
  }
  changeState(state: string) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  async resume() {
    this.resumeCalls++;
    if (!this.allowed) throw Error('activation needed');
    this.changeState('running');
  }
  async close() { this.changeState('closed'); }
}

function setup() {
  const context = new FakeContext(), gestures = new EventTarget();
  let time = 0, contexts = 0;
  const statuses: RoomMusicPlaybackStatus[] = [];
  const player = new RoomMusicPlayback(s => statuses.push(s), {
    gestures,
    now: () => time,
    createContext: () => { contexts++; return context as unknown as AudioContext; },
  });
  return { context, gestures, player, statuses, contexts: () => contexts,
    advance: (ms: number) => { time += ms; if (context.state === 'running') context.currentTime += ms / 1000; } };
}

test('a normal pre-subscription gesture unlocks one context and frames decode as standard mono µ-law', () => {
  const { player, context, contexts, statuses, advance } = setup();
  player.unlock();
  player.setSubscribed(true);
  player.push(1, pattern);
  const first = context.sources[0];
  assert.equal(contexts(), 1);
  assert.equal(first.output, context.gain);
  assert.deepEqual([...first.buffer!.getChannelData().slice(0, 4)], [-32124 / 32768, 0, 32124 / 32768, 0]);
  assert.ok(first.startAt > 0 && first.startAt < .2);
  advance(130);
  player.push(2, pattern);
  const second = context.sources[1];
  assert.ok(Math.abs(second.startAt - first.startAt - .150) < 1e-8);
  assert.deepEqual(statuses, ['playing']);
  first.end(); second.end();
  assert.equal(player.status, 'waiting');
});

test('locked guests discard frames and resume only from a gesture, including a retry after denial', async () => {
  const { player, context, gestures, contexts, statuses, advance } = setup();
  player.setSubscribed(true);
  player.push(1, pattern);
  assert.equal(contexts(), 0);
  assert.equal(player.status, 'needs-click');
  context.allowed = false;
  gestures.dispatchEvent(new Event('click'));
  await Promise.resolve();
  assert.equal(context.resumeCalls, 1);
  assert.equal(player.status, 'needs-click');
  context.allowed = true;
  gestures.dispatchEvent(new Event('keydown'));
  advance(150);
  player.push(1, pattern);
  assert.equal(context.sources.length, 0);
  player.push(2, pattern);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(statuses, ['needs-click', 'waiting', 'playing']);
});

test('ordering rejects malformed, duplicate and old packets and restarts cleanly across gaps and generations', () => {
  const { player, context } = setup();
  player.setSubscribed(true); player.unlock();
  for (const seq of [0, -1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) player.push(seq, pattern);
  player.push(75, '*'.repeat(4800)); player.push(100, 'bad');
  assert.equal(context.sources.length, 0);
  player.push(10, pattern); player.push(10, pattern); player.push(3, pattern);
  assert.equal(context.sources.length, 1);
  player.push(12, pattern);
  assert.equal(context.sources[0].stopped, true);
  assert.equal(context.sources[0].output, null);
  player.stop();
  assert.equal(player.status, 'waiting');
  assert.equal(context.sources[1].stopped, true);
  player.push(1, pattern);
  assert.equal(context.sources.length, 3);
});

test('throttling discards wake-up bursts, suspension stops scheduled sound, and jitter stays bounded', () => {
  const { player, context, gestures, advance } = setup();
  player.setSubscribed(true); player.unlock(); player.push(1, pattern);
  advance(900);
  player.push(2, pattern); player.push(3, pattern);
  assert.equal(context.sources.length, 1);
  assert.ok(context.sources[0].stopped);
  advance(150); player.push(4, pattern);
  context.changeState('suspended');
  assert.ok(context.sources[1].stopped);
  player.push(5, pattern);
  assert.equal(player.status, 'needs-click');
  gestures.dispatchEvent(new Event('click'));
  player.push(6, pattern);
  assert.equal(context.sources.length, 2);
  advance(150);
  for (let seq = 7; seq < 107; seq++) {
    player.push(seq, pattern);
    const active = context.sources.filter(source => !source.stopped);
    assert.ok(active.length > 0 && active.length <= 4);
    assert.ok(active.at(-1)!.startAt + .15 <= context.currentTime + .6 + 1e-8);
  }
});

test('mute, unsubscribe and disposal cancel live and scheduled nodes and release the context', () => {
  const { player, context, gestures, advance } = setup();
  player.setSubscribed(true); player.unlock(); player.push(1, pattern); player.push(2, pattern);
  player.setMuted(true);
  assert.equal(context.gain.gain.value, 0);
  assert.ok(context.sources.every(s => s.stopped && !s.output));
  player.push(3, pattern);
  assert.equal(context.sources.length, 2);
  player.setMuted(false);
  player.push(3, pattern);
  assert.equal(context.sources.length, 2);
  advance(150); player.push(4, pattern);
  assert.equal(context.gain.gain.value, 1);
  player.setSubscribed(false); player.push(5, pattern);
  assert.equal(context.sources.length, 3);
  assert.ok(context.sources.every(s => s.stopped && !s.output));
  player.dispose();
  gestures.dispatchEvent(new Event('click'));
  assert.equal(context.state, 'closed');
  assert.equal(player.status, 'waiting');
});
