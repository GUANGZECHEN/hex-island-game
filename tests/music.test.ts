import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMusicTracks } from '../src/game/ui/music.ts';

const file = (name: string, type = '') => new File(['audio'], name, { type });

test('selects m01001 for the lobby and sorts the other audio tracks', () => {
  const tracks = selectMusicTracks([
    file('Theme 10.wav'), file('M01001.MP3'), file('Theme 2.ogg'),
    file('README.txt'), file('m01001.wav'), file('Theme 1', 'audio/mpeg'),
  ]);
  assert.equal(tracks?.lobby.name, 'M01001.MP3');
  assert.deepEqual(tracks?.match.map(track => track.name), ['Theme 1', 'Theme 2.ogg', 'Theme 10.wav']);
});

test('accepts numbered tracks without extensions and validates both playlists', () => {
  assert.equal(selectMusicTracks([file('m01001')]), null);
  assert.equal(selectMusicTracks([file('m01002.wav')]), null);
  assert.equal(selectMusicTracks([file('m01001'), new File([], 'm01002.wav')]), null);
  assert.equal(selectMusicTracks([file('m01001'), file('m01002')])?.match[0].name, 'm01002');
});
