import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomToken,
  validToken,
  hash,
  authorize,
  canRoute,
  parseRoutedMessage,
  allowedOrigin,
  MAX_MESSAGE,
  MAX_RELAY_DATA,
} from '../src/protocol.ts';

test('tokens are random, correctly formatted and hashed', async()=>{
  const a=randomToken(),b=randomToken();
  assert.ok(validToken(a));
  assert.notEqual(a,b);
  assert.equal(validToken('short'),false);
  assert.notEqual(await hash(a),a);
  assert.equal(await hash(a),await hash(a));
});

test('authorization enforces credentials, expiry, host and capacity',()=>{
  assert.equal(authorize('host','x','x',10,1,false,0),null);
  assert.equal(authorize('guest','x','y',10,1,true,1),'invalid');
  assert.equal(authorize('guest','x','x',10,10,true,1),'expired');
  assert.equal(authorize('guest','x','x',10,1,false,0),'host-unavailable');
  assert.equal(authorize('guest','x','x',10,1,true,4),'room-full');
  assert.equal(authorize('host','x','x',10,1,true,1),'host-unavailable');
});

test('relay messages are bounded strings with a single trusted shape',()=>{
  const valid=JSON.stringify({type:'relay',to:'host',data:'hello'});
  assert.deepEqual(parseRoutedMessage(valid),{type:'relay',to:'host',data:'hello'});

  for(const invalid of [
    '{',
    'null',
    JSON.stringify({type:'offer',to:'host',data:'sdp'}),
    JSON.stringify({type:'relay',to:'host',data:{secret:true}}),
    JSON.stringify({type:'relay',to:'bad peer',data:'x'}),
    JSON.stringify({type:'relay',to:'host',data:'x',extra:true}),
    JSON.stringify({type:'relay',to:'host',data:'x'.repeat(MAX_RELAY_DATA+1)}),
    'x'.repeat(MAX_MESSAGE+1),
  ]) assert.equal(parseRoutedMessage(invalid),null);
});

test('origin allowlist',()=>{
  assert.ok(allowedOrigin('https://guangzechen.github.io'));
  assert.ok(allowedOrigin('http://localhost:5173'));
  assert.equal(allowedOrigin('https://evil.example'),false);
  assert.equal(allowedOrigin(null),false);
});

test('routes only through host',()=>{
  assert.equal(canRoute('guest','host',['one','two']),true);
  assert.equal(canRoute('guest','two',['one','two']),false);
  assert.equal(canRoute('host','one',['one','two']),true);
  assert.equal(canRoute('host','host',['one']),false);
  assert.equal(canRoute('host','unknown',['one']),false);
});
