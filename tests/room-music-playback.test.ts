import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomMusicPlayback, type RoomMusicPlaybackStatus } from '../src/game/ui/room-music-playback.ts';
import { ROOM_MUSIC_FRAME_SAMPLES, ROOM_MUSIC_SAMPLE_RATE } from '../src/game/network/room-music.ts';

const pattern = btoa(String.fromCharCode(0, 255, 128, 127).repeat(ROOM_MUSIC_FRAME_SAMPLES / 4));

const FRAME_SECONDS = ROOM_MUSIC_FRAME_SAMPLES / ROOM_MUSIC_SAMPLE_RATE;
// Allow a one-frame measurement tolerance at the three-second upper bound.
const MAX_QUEUE_SECONDS = 3 + FRAME_SECONDS;
const EPSILON = 1e-8;

class FakeSource {
  buffer: { duration: number; getChannelData(): Float32Array } | null = null;
  output: object | null = null;
  onended: (() => void) | null = null;
  startAt = -1;
  stopped = false;
  ended = false;
  get endAt(): number { return this.startAt + (this.buffer?.duration ?? 0); }
  connect(output: object) { this.output = output; }
  start(at: number) { this.startAt = at; }
  stop() { this.stopped = true; }
  disconnect() { this.output = null; }
  end() {
    if (this.ended || this.stopped) return;
    this.ended = true;
    this.onended?.();
  }
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
    return { duration: frames / rate, getChannelData: () => samples };
  }
  advance(ms: number, deliverEnded = true) {
    if (this.state === 'running') this.currentTime += ms / 1000;
    if (deliverEnded) this.dispatchEnded();
  }
  dispatchEnded() {
    for (const source of this.sources) {
      if (source.startAt >= 0 && source.endAt <= this.currentTime + EPSILON) source.end();
    }
  }
  get playable() {
    return this.sources.filter(s => s.startAt >= 0 && !s.stopped && !s.ended && s.endAt > this.currentTime + EPSILON);
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
  const options = {
    gestures,
    now: () => time,
    createContext: () => { contexts++; return context as unknown as AudioContext; },
  };
  const player = new RoomMusicPlayback(s => statuses.push(s), options);
  const advance = (wallMs: number, audioMs = wallMs, deliverEnded = true) => {
    time += wallMs;
    context.advance(audioMs, deliverEnded);
  };
  return { context, gestures, player, statuses, contexts: () => contexts, advance };
}

function assertBounded(context: FakeContext) {
  const queued = context.playable;
  assert.ok(queued.length > 0, 'live playback must have a scheduled source');
  assert.ok(queued.length <= Math.ceil(MAX_QUEUE_SECONDS / FRAME_SECONDS) + 1, 'scheduled source count is bounded');
  for (const source of queued) {
    assert.ok(source.endAt - context.currentTime <= MAX_QUEUE_SECONDS + EPSILON, 'scheduled duration is bounded');
  }
}

function assertContiguous(sources: FakeSource[]) {
  for (let i = 1; i < sources.length; i++) {
    assert.ok(Math.abs(sources[i].startAt - sources[i - 1].endAt) < EPSILON, `audible gap or overlap before frame ${i + 1}`);
  }
}

function markedFrame(seq: number) {
  // The bottom four positive G.711 bits decode in increments of 8/32768.
  return btoa(String.fromCharCode(255 - seq % 16).repeat(ROOM_MUSIC_FRAME_SAMPLES));
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
  assert.ok(first.startAt > 0);
  assertBounded(context);
  advance(130);
  player.push(2, pattern);
  const second = context.sources[1];
  assert.ok(Math.abs(second.startAt - first.startAt - .150) < 1e-8);
  assert.deepEqual(statuses, ['playing']);
  advance((second.endAt - context.currentTime) * 1000 + 1);
  assert.ok(first.ended && second.ended);
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

test('ordering rejects malformed, duplicate and old packets; a missing packet preserves the playout queue', () => {
  const { player, context } = setup();
  player.setSubscribed(true); player.unlock();
  for (const seq of [0, -1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) player.push(seq, pattern);
  player.push(75, '*'.repeat(4800)); player.push(100, 'bad');
  assert.equal(context.sources.length, 0);
  player.push(10, pattern); player.push(10, pattern); player.push(3, pattern);
  assert.equal(context.sources.length, 1);
  const beforeGap = context.sources[0];
  player.push(12, pattern);
  assert.ok(context.playable.includes(beforeGap));
  assert.equal(beforeGap.output, context.gain);
  const afterGap = context.sources.at(-1)!;
  assert.notEqual(afterGap, beforeGap);
  assert.ok(afterGap.startAt + EPSILON >= beforeGap.endAt);
  assertBounded(context);

  player.stop();
  assert.equal(player.status, 'waiting');
  assert.ok(context.sources.every(source => source.stopped && !source.output));
  player.push(1, pattern);
  assert.equal(context.playable.length, 1, 'a new stream may restart its sequence');
});

test('seven-frame relay bursts every 1.05 seconds produce continuous audio in the original order', () => {
  const { player, context, advance, statuses } = setup();
  player.setSubscribed(true); player.unlock();
  let seq = 1;
  player.push(seq, markedFrame(seq));
  for (let batch = 0; batch < 5; batch++) {
    advance(1050);
    for (let i = 0; i < 7; i++) {
      seq++;
      player.push(seq, markedFrame(seq));
    }
    assertBounded(context);
  }
  assert.equal(context.sources.length, seq, 'jitter within budget must retain each frame');
  assertContiguous(context.sources);
  assert.deepEqual(context.sources.map(s => s.buffer!.getChannelData()[0]),
    Array.from({ length: seq }, (_, i) => ((i + 1) % 16) * 8 / 32768));
  assert.ok(context.sources.every(source => !source.stopped), 'normal delivery must not cancel any sound');
  assert.deepEqual(statuses, ['playing']);
  const last = context.sources.at(-1)!;
  advance((last.endAt - context.currentTime) * 1000 + 1);
  assert.equal(player.status, 'waiting');
});

test('a large overrun keeps queued sound and bounds further frames, then accepts live arrivals as room opens', () => {
  const { player, context, advance } = setup();
  player.setSubscribed(true); player.unlock();
  for (let seq = 1; seq <= 5; seq++) player.push(seq, pattern);
  const preserved = [...context.playable];
  assert.equal(preserved.length, 5);
  for (let seq = 6; seq <= 140; seq++) {
    player.push(seq, pattern);
    assertBounded(context);
  }
  assert.ok(preserved.every(source => context.playable.includes(source)));
  assertContiguous(context.playable);
  const last = context.sources.at(-1)!;
  const count = context.sources.length;
  advance((last.endAt - context.currentTime - FRAME_SECONDS) * 1000);
  player.push(141, pattern);
  assert.ok(context.sources.length > count);
  assertBounded(context);
});

test('a late JavaScript callback with playable audio and a real playout underrun recover differently', () => {
  const { player, context, advance } = setup();
  player.setSubscribed(true); player.unlock();
  player.push(1, pattern); player.push(2, pattern);
  const first = context.sources[0];
  // Wall time alone cannot establish that a still-running audio clock exhausted its queue.
  advance(1600, 0);
  player.push(3, pattern);
  assert.ok(context.playable.includes(first));
  assertContiguous(context.sources);
  assertBounded(context);

  // The audio device consumes the queue even if JavaScript has not delivered onended yet.
  advance(8000, 8000, false);
  assert.equal(context.playable.length, 0);
  const restartTime = context.currentTime;
  player.push(43, pattern);
  advance(150);
  player.push(44, pattern);
  assertBounded(context);
  assert.ok(context.playable.every(source => source.startAt >= restartTime));
  assert.equal(player.status, 'playing');
  assert.ok(first.ended || first.stopped);
});

test('a suspended guest cancels queued audio and resumes from fresh frames after a browser gesture', () => {
  const { player, context, gestures, advance } = setup();
  player.setSubscribed(true); player.unlock();
  player.push(1, pattern); player.push(2, pattern);
  context.changeState('suspended');
  assert.ok(context.sources.every(source => source.stopped && !source.output));
  for (let seq = 3; seq <= 7; seq++) player.push(seq, pattern);
  assert.equal(context.sources.length, 2);
  assert.equal(player.status, 'needs-click');
  advance(1200);
  gestures.dispatchEvent(new Event('click'));
  advance(150);
  player.push(7, pattern);
  assert.equal(context.playable.length, 0);
  player.push(8, pattern);
  assertBounded(context);
  assert.equal(player.status, 'playing');
});

test('mute, unsubscribe and disposal cancel live and scheduled nodes and release the context', () => {
  const { player, context, gestures, advance } = setup();
  player.setSubscribed(true); player.unlock(); player.push(1, pattern); player.push(2, pattern);
  const first = context.sources[0];
  advance((first.startAt + FRAME_SECONDS / 2) * 1000);
  assert.ok(first.startAt <= context.currentTime && first.endAt > context.currentTime);
  assert.ok(context.sources[1].startAt > context.currentTime);
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
  player.setSubscribed(true); player.push(1, pattern);
  assert.equal(context.playable.length, 1, 'rejoining a room accepts the new sequence');
  player.dispose();
  assert.ok(context.sources.every(source => source.stopped && !source.output));
  gestures.dispatchEvent(new Event('click'));
  assert.equal(context.state, 'closed');
  assert.equal(player.status, 'waiting');
});
