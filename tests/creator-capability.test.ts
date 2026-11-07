import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorCapabilityHash, generateCreatorCapability } from '../scripts/creator-capability.mjs';

test('creator capability helper generates a 256-bit token and non-reversible verifier',()=>{
 const first=generateCreatorCapability(),second=generateCreatorCapability();
 assert.match(first.capability,/^[A-Za-z0-9_-]{43}$/);
 assert.match(first.hash,/^[0-9a-f]{64}$/);
 assert.equal(first.hash,creatorCapabilityHash(first.capability));
 assert.notEqual(first.capability,second.capability);
 assert.notEqual(first.hash,second.hash);
 assert.notEqual(first.capability,first.hash);
});
