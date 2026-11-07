import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRoom, RoomError } from '../src/room-request.ts';

const secret='private-response-canary';
const creator='D'.repeat(43);
const id='A'.repeat(43);

test('room creation sends creator authority only in the authorization header',async()=>{
  const result=await requestRoom('https://example.invalid',creator,async(_url,options)=>{
    assert.equal(options?.method,'POST');
    const headers=new Headers(options?.headers);
    assert.equal(headers.get('authorization'),`Bearer ${creator}`);
    assert.equal(headers.get('content-type'),'application/json');
    return new Response(JSON.stringify({room:id,host:id,guest:id}),{status:201});
  });
  assert.deepEqual(result,{room:id,host:id,guest:id});
});

test('room creation reports safe client, network, HTTP and malformed response failures',async()=>{
  await assert.rejects(requestRoom('https://example.invalid','short',async()=>{throw Error('should not fetch');}),e=>e instanceof RoomError&&e.message==='Private host link is invalid.');
  await assert.rejects(requestRoom('https://example.invalid',creator,async()=>{throw Error(secret);}),e=>e instanceof RoomError&&e.message==='Signaling service is unreachable.');
  await assert.rejects(requestRoom('https://example.invalid',creator,async()=>new Response(secret,{status:401})),e=>e instanceof RoomError&&e.message==='Room creation failed (HTTP 401).');
  await assert.rejects(requestRoom('https://example.invalid',creator,async()=>new Response(secret,{status:500})),e=>e instanceof RoomError&&e.message==='Room creation failed (HTTP 500).');
  await assert.rejects(requestRoom('https://example.invalid',creator,async()=>new Response(secret,{status:201})),e=>e instanceof RoomError&&e.message==='Room creation returned an invalid response.');
});
