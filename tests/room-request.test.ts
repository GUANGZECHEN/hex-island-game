import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRoom, RoomError } from '../src/room-request.ts';
const secret='private-response-canary';
test('room creation reports safe network, HTTP and malformed response failures',async()=>{
 await assert.rejects(requestRoom('https://example.invalid',async()=>{throw Error(secret);}),e=>e instanceof RoomError&&e.message==='Signaling service is unreachable.');
 await assert.rejects(requestRoom('https://example.invalid',async()=>new Response(secret,{status:500})),e=>e instanceof RoomError&&e.message==='Room creation failed (HTTP 500).');
 await assert.rejects(requestRoom('https://example.invalid',async()=>new Response(secret,{status:201})),e=>e instanceof RoomError&&e.message==='Room creation returned an invalid response.');
 const id='A'.repeat(43);assert.deepEqual(await requestRoom('https://example.invalid',async()=>new Response(JSON.stringify({room:id,host:id,guest:id}),{status:201})),{room:id,host:id,guest:id});
});
