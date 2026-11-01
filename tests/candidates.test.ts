import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countCandidates, formatCandidates } from '../src/candidates.ts';

test('counts candidate types without exposing candidate addresses', () => {
  const sdp = ['v=0', 'a=candidate:1 1 udp 1 192.0.2.1 123 typ host', 'a=candidate:2 1 udp 1 198.51.100.1 123 typ srflx', 'a=candidate:3 1 udp 1 203.0.113.1 123 typ relay', 'a=candidate:4 1 udp 1 example.local 123 typ prflx', 'a=candidate:5 1 udp 1 example.local 123 typ future'].join('\r\n');
  assert.deepEqual(countCandidates(sdp), {total: 5, host: 1, srflx: 1, prflx: 1, relay: 1, unknown: 1});
  assert.doesNotMatch(formatCandidates(sdp), /192\.0\.2\.1|example\.local|candidate:/);
  assert.equal(countCandidates(undefined).total, 0);
});
