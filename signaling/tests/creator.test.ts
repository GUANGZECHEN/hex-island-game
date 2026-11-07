import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCreator, constantTimeEqual, hash } from '../src/protocol.ts';

const oldCreator='A'.repeat(43);
const newCreator='B'.repeat(43);

test('creator verifier fails closed for missing, malformed and incorrect capabilities',async()=>{
 const stored=await hash(oldCreator);
 assert.equal(await authorizeCreator(undefined,stored),false);
 assert.equal(await authorizeCreator('short',stored),false);
 assert.equal(await authorizeCreator(newCreator,stored),false);
 assert.equal(await authorizeCreator(oldCreator,undefined),false);
 assert.equal(await authorizeCreator(oldCreator,'not-a-hash'),false);
});

test('current creator capability matches its SHA-256 verifier',async()=>{
 const stored=await hash(oldCreator);
 assert.match(stored,/^[0-9a-f]{64}$/);
 assert.equal(await authorizeCreator(oldCreator,stored),true);
 assert.equal(constantTimeEqual(stored,stored),true);
});

test('manual rotation invalidates the old creator verifier without changing room credentials',async()=>{
 const existingRoom={hostHash:await hash('H'.repeat(43)),guestHash:await hash('G'.repeat(43)),expires:123456789};
 const before=structuredClone(existingRoom);
 const rotatedHash=await hash(newCreator);
 assert.equal(await authorizeCreator(oldCreator,rotatedHash),false);
 assert.equal(await authorizeCreator(newCreator,rotatedHash),true);
 assert.deepEqual(existingRoom,before);
 assert.deepEqual(Object.keys(existingRoom).sort(),['expires','guestHash','hostHash']);
});
