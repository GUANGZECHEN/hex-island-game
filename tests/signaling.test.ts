import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal } from '../src/signaling.ts';

test('offer and answer round-trip without changing SDP', () => {
  for (const type of ['offer', 'answer'] as const) { const sdp = 'v=0\r\na=candidate:example\r\n'; assert.deepEqual(decodeSignal(encodeSignal({ type, sdp }), type), { version: 1, type, sdp }); }
});
test('rejects malformed, wrong-type, and empty connection data', () => {
  for (const input of ['{', 'null', '[]', '{}', '{"version":2,"type":"offer","sdp":"x"}', '{"version":1,"type":"answer","sdp":"x"}', '{"version":1,"type":"offer","sdp":" "}']) assert.throws(() => decodeSignal(input, 'offer'));
  assert.throws(() => encodeSignal({ type: 'offer', sdp: '' }));
});
