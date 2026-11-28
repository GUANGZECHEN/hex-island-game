import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicQueue } from '../src/game/ui/music-queue.ts';

const keepOrder = () => .9999;

test('a new match shuffles stable library indices and can avoid the previous track', () => {
  const first = new MusicQueue(4, () => 0);
  assert.deepEqual(first.order, [1, 2, 3, 0]);
  assert.equal(first.current, 1);
  const next = new MusicQueue(4, () => 0, first.current);
  assert.equal(next.current, 2);
  assert.deepEqual([...next.order].sort(), [0, 1, 2, 3]);
});

test('every automatic pass contains all tracks and avoids an immediate repeat', () => {
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const queue = new MusicQueue(5, random);
  let previous = -1;
  for (let pass = 0; pass < 8; pass++) {
    assert.notEqual(queue.current, previous);
    const picks = [];
    for (let i = 0; i < 5; i++) {
      picks.push(queue.current);
      previous = queue.current;
      queue.advance();
    }
    assert.deepEqual(picks.sort(), [0, 1, 2, 3, 4]);
  }
});

test('moving tracks changes upcoming playback and keeps heard tracks and current playback intact', () => {
  const queue = new MusicQueue(5, keepOrder);
  const initialOrder = queue.order;
  queue.advance();
  queue.move(4, -1);
  queue.move(4, -1);
  assert.equal(queue.current, 1);
  assert.deepEqual(initialOrder, [0, 1, 2, 3, 4]);
  assert.deepEqual(queue.order, [0, 1, 4, 2, 3]);
  queue.advance();
  assert.equal(queue.current, 4);
  queue.select(3);
  queue.move(2, -1);
  queue.advance();
  assert.equal(queue.current, 2, 'wrap past heard tracks to the last unheard track');
});

test('choosing tracks can replay a selection without moving it or replaying it automatically', () => {
  const queue = new MusicQueue(4, keepOrder);
  queue.select(2);
  queue.advance();
  assert.equal(queue.current, 3);
  queue.select(0);
  queue.select(0);
  assert.deepEqual(queue.order, [0, 1, 2, 3]);
  assert.equal(queue.current, 0);
  queue.advance();
  assert.equal(queue.current, 1);
  queue.select(0);
  queue.advance();
  assert.notEqual(queue.current, 0, 'even a replay at the boundary must not immediately repeat');
});

test('explicit shuffle retains the current song and starts a fresh pass of all remaining songs', () => {
  const queue = new MusicQueue(4, keepOrder);
  queue.advance();
  queue.advance();
  queue.shuffle();
  assert.equal(queue.current, 2);
  assert.deepEqual(queue.order, [2, 0, 1, 3]);
  const rest = [];
  for (let i = 0; i < 3; i++) {
    queue.advance();
    rest.push(queue.current);
  }
  assert.deepEqual(rest, [0, 1, 3]);
});

test('empty and single-track libraries and invalid selections are safe', () => {
  const empty = new MusicQueue(0);
  empty.advance();
  empty.select(0);
  empty.move(0, 1);
  empty.shuffle();
  assert.equal(empty.current, -1);
  assert.deepEqual(empty.order, []);
  const only = new MusicQueue(1, keepOrder, 0);
  only.advance();
  only.shuffle();
  assert.equal(only.current, 0);
  assert.deepEqual(only.order, [0]);

  const queue = new MusicQueue(3, keepOrder);
  for (const invalid of [-1, 3, .5, NaN]) {
    queue.select(invalid);
    queue.move(invalid, 1);
  }
  queue.move(0, -1);
  queue.move(2, 1);
  assert.equal(queue.current, 0);
  assert.deepEqual(queue.order, [0, 1, 2]);
});

test('pressing Shuffle changes the visible queue when the upcoming songs can trade places', () => {
  const queue = new MusicQueue(3, keepOrder);
  const before = [...queue.order];
  queue.shuffle();
  assert.equal(queue.current, before[0]);
  assert.notDeepEqual(queue.order, before);
  assert.deepEqual([...queue.order].sort(), [...before].sort());
});
