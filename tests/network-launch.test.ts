import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuestInvite, parseRoomLaunch } from '../src/game/network/launch.ts';

const creator='A'.repeat(43),room='B'.repeat(43),guest='C'.repeat(43);

test('creator and guest launch modes stay capability-separated',()=>{
 assert.deepEqual(parseRoomLaunch(`#create=${creator}`),{kind:'creator',capability:creator});
 assert.deepEqual(parseRoomLaunch(`#join=${room}.${guest}`),{kind:'invite',room,capability:guest});
 assert.deepEqual(parseRoomLaunch(''),{kind:'public'});
 for(const bad of [`#create=short`,`#join=${room}.short`,`#create=${creator}&join=${room}.${guest}`,`#create=${creator}&create=${creator}`])assert.deepEqual(parseRoomLaunch(bad),{kind:'invalid'});
});

test('guest invite replaces any creator fragment and never carries creator authority',()=>{
 const invite=buildGuestInvite(`https://example.test/game?qaPlayers=2#create=${creator}`,room,guest);
 const url=new URL(invite);
 assert.equal(url.hash,`#join=${room}.${guest}`);
 assert.equal(invite.includes('create='),false);
 assert.equal(url.search,'?qaPlayers=2');
});
