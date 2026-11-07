import test from 'node:test';
import assert from 'node:assert/strict';
import { reconnectDelay } from '../src/rooms.ts';

test('reconnect stays fast first, then continues indefinitely at low frequency',()=>{
  assert.equal(reconnectDelay(1),500);
  assert.equal(reconnectDelay(5),8000);
  assert.equal(reconnectDelay(10),8000);
  assert.equal(reconnectDelay(11),30000);
  assert.equal(reconnectDelay(30),30000);
  assert.equal(reconnectDelay(31),60000);
  assert.equal(reconnectDelay(100000),60000);
});
