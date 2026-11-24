import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GameMusic, restoreMusicLibrary, selectMusicTracks } from '../src/game/ui/music.ts';

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

test('reserved endings are case-insensitive, deduplicated and removed from old saved match queues', () => {
  const lobby=file('m01001.wav'), battle=file('m01002.flac'), win=file('m01017.wav'), duplicateWin=file('M01017.ogg'), loss=file('M01018');
  const saved=restoreMusicLibrary({lobby,match:[loss,win,battle,duplicateWin]});
  assert.deepEqual(saved?.match,[battle]);
  assert.equal(saved?.win,win,'prefer the explicitly named WAV over another encoding');
  assert.equal(saved?.loss,loss);
  assert.deepEqual(restoreMusicLibrary(saved!),saved);
  const onlyEndings=selectMusicTracks([lobby,win,loss]);
  assert.deepEqual(onlyEndings?.match,[]);
  assert.equal(onlyEndings?.win,win);
  assert.equal(onlyEndings?.loss,loss);
});

async function musicPlayer(t: TestContext) {
  class Node extends EventTarget {
    hidden=false; disabled=false; paused=true; ended=false; loop=false;
    dataset:Record<string,string>={}; textContent=''; selectedIndex=0; length=0; value='';
    files:File[]=[]; src=''; volume=1; playCount=0; block=false;
    click(){this.dispatchEvent(new Event('click'));}
    replaceChildren(...children:unknown[]){this.length=children.length;}
    removeAttribute(){this.src='';}
    load(){this.ended=false;this.paused=true;}
    pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
    async play(){
      if(this.block)throw new DOMException('gesture required','NotAllowedError');
      this.paused=false;this.ended=false;this.playCount++;this.dispatchEvent(new Event('playing'));
    }
  }
  const nodes=new Map<string,Node>(), get=(id:string)=>{let n=nodes.get(id);if(!n){n=new Node();nodes.set(id,n);}return n;};
  const doc=Object.assign(new EventTarget(),{querySelector:get});
  const replacements={document:doc,Option:class {},localStorage:{getItem:()=>null,setItem(){}},indexedDB:undefined};
  for(const [key,value] of Object.entries(replacements)){
    const before=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>{if(before)Object.defineProperty(globalThis,key,before);else Reflect.deleteProperty(globalThis,key);});
  }
  const music=new GameMusic(), audio=get('#music-player');
  const choose=(...tracks:File[])=>{const input=get('#music-files');input.files=tracks;input.dispatchEvent(new Event('change'));};
  return {music,audio,choose,get,doc};
}

test('each outcome preempts a one-track gameplay loop, plays once and restarts cleanly',async t=>{
  const {music,audio,choose,get,doc}=await musicPlayer(t);
  choose(file('M01001.wav'),file('m01002.wav'),file('M01017.WAV'),file('m01018.wav'));
  music.setScene('lobby');assert.equal(audio.loop,true);
  music.setScene('match','one');assert.equal(audio.loop,true);assert.equal(get('#music-queue').length,1);
  music.setScene('win','one');assert.equal(audio.loop,false);assert.equal(audio.dataset.scene,'win');
  assert.match(get('#music-status').textContent,/M01017.WAV/);assert.equal(get('#music-playlist').hidden,true);
  const plays=audio.playCount,source=audio.src;
  let muteChanges=0;music.addEventListener('mutechange',()=>{muteChanges++;});
  music.setScene('win','one');assert.equal(audio.src,source);assert.equal(audio.playCount,plays);
  audio.ended=true;audio.paused=true;audio.dispatchEvent(new Event('ended'));
  music.setRoomListening(true);music.setRoomListening(false);doc.dispatchEvent(new Event('click'));
  assert.equal(audio.playCount,plays);assert.equal(muteChanges,0,'completion and channel changes are not a host mute intent');
  music.setScene('loss','two');assert.notEqual(audio.src,source);assert.equal(audio.loop,false);assert.match(get('#music-status').textContent,/m01018.wav/);
  music.setScene('spectator-end','two');assert.equal(audio.src,'');
  music.setScene('match','three');assert.equal(audio.loop,true);assert.equal(get('#music-playlist').hidden,false);
  music.setScene('menu');
});

test('missing endings fall silent and a blocked or muted ending waits for deliberate playback',async t=>{
  const {music,audio,choose,get,doc}=await musicPlayer(t);
  choose(file('m01001.wav'),file('m01002.wav'),file('m01017.wav'));
  music.setScene('match','one');
  let changes=0;music.addEventListener('mutechange',()=>{changes++;});
  get('#music-toggle').click();assert.equal(music.isMuted,true);assert.equal(changes,1);
  music.setScene('win','one');assert.equal(audio.paused,true);
  doc.dispatchEvent(new Event('click'));assert.equal(audio.paused,true);
  audio.block=true;get('#music-toggle').click();await Promise.resolve();assert.equal(music.isMuted,false);assert.equal(changes,2);
  assert.match(get('#music-status').textContent,/Play music/);
  audio.block=false;doc.dispatchEvent(new Event('click'));assert.equal(audio.paused,false);
  music.setScene('loss','one');assert.equal(audio.src,'');assert.match(get('#music-status').textContent,/m01018/);
});
