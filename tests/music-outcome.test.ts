import test from 'node:test';
import assert from 'node:assert/strict';
import { matchMusicScene } from '../src/game/music-outcome.ts';

test('match music follows the listening seat and the confirmed result', () => {
  const classic = { phase: 'finished', winner: 'Player 2' };
  assert.equal(matchMusicScene({...classic, phase:'action'}, 'Player 1'), 'match');
  assert.equal(matchMusicScene(classic, 'Player 2'), 'win');
  assert.equal(matchMusicScene(classic, 'Player 1'), 'loss');
  assert.equal(matchMusicScene(classic, null), 'spectator-end');
  for (const outcome of ['won','lost'] as const) {
    const coop = {phase:'finished', winner:null, harbor:{outcome}};
    for (const seat of ['Player 1','Player 2']) {
      assert.equal(matchMusicScene(coop, seat), outcome==='won'?'win':'loss');
    }
    assert.equal(matchMusicScene(coop, null), 'spectator-end');
  }
});
