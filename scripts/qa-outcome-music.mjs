import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { createGame } from '../src/game/rules/state.ts';
import { HostAuthority } from '../src/game/network/authority.ts';
import { HostSession } from '../src/game/network/session.ts';
import { isRoomMusicMessage, RoomMusicGuest } from '../src/game/network/room-music.ts';

const names = ['m01001','m01002','m01003','m01017','m01018'];
const tones = [260,330,360,550,750];
const gameId = 'ending-qa';
const sourcePath = 'src/__qa-outcome-music-' + process.pid + '.ts';
const htmlPath = '__qa-outcome-music-' + process.pid + '.html';
const url = 'http://127.0.0.1:4187/hex-island-game/' + htmlPath + '?renderer=2d';

function wav(hz) {
  const rate=8000, samples=rate*10, audio=Buffer.alloc(44+samples*2);
  audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(rate,24);audio.writeUInt32LE(rate*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);
  audio.write('data',36);audio.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) audio.writeInt16LE(Math.round(8500*Math.sin(2*Math.PI*hz*i/rate)),44+i*2);
  return audio;
}

// Seed a near-victory fixture. The end transition itself is the ordinary claim command.
function nearVictory(state,id,topology) {
  state.turn=8;state.phase='action';state.currentSeat=state.players.findIndex(p=>p.id===id);
  const chosen=new Set();state.buildings={};
  for(const vertex of topology.vertices) {
    if(topology.edges.some(edge=>edge.vertexIds.includes(vertex.id)&&edge.vertexIds.some(v=>chosen.has(v)))) continue;
    state.buildings[vertex.id]={playerId:id,kind:chosen.size<4?'city':'settlement'};chosen.add(vertex.id);
    if(chosen.size===6)break;
  }
  const seat=state.players[state.currentSeat];seat.cities=0;seat.settlements=3;
}

async function enterLocal(page,bots) {
  await page.getByRole('button',{name:'Create local room'}).click();
  await page.locator('#local-bot-count').selectOption(String(bots));
  await page.locator('#start').click();
  if(await page.locator('#pass').isVisible())await page.locator('#reveal').click();
  await page.waitForFunction(()=>document.querySelector('#music-player').dataset.scene==='match');
  await page.waitForFunction(()=>document.querySelector('#music-queue').options.length===2);
  const entries=await page.locator('#music-queue option').allTextContents();
  assert.deepEqual(entries.sort(),['m01002.wav','m01003.wav'],'end tracks stay out of the match playlist');
}

async function localTrack(page,scene,name) {
  await page.waitForFunction(({scene,name})=>{
    const a=document.querySelector('#music-player');
    return a.dataset.scene===scene&&!a.paused&&a.currentTime>0&&
      document.querySelector('#music-status').textContent.toLowerCase().includes(name+'.wav');
  },{scene,name},{timeout:10000});
  const looping=await page.locator('#music-player').evaluate(a=>a.loop);
  assert.equal(looping,false,'outcome audio plays once');
}
async function importFolder(page,folder) {
  await page.locator('#music-files').setInputFiles(folder);
}

async function localChecks(browser,folder) {
  const context=await browser.newContext();
  try{
    const page=await context.newPage();await page.goto(url);
    await page.locator('#music-files').evaluate(input=>input.addEventListener('change',()=>{
      window.__qaImported=[...input.files];
    },{capture:true,once:true}));
    await importFolder(page,folder);
    // Restore an actual v1 IndexedDB object to exercise migration on page refresh.
    await page.evaluate(async()=>{
      const files=window.__qaImported;
      const db=await new Promise((ok,fail)=>{const req=indexedDB.open('hex-background-music-v1',1);
        req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error);});
      await new Promise((ok,fail)=>{const tx=db.transaction('tracks','readwrite');
        tx.objectStore('tracks').put({lobby:files.find(f=>f.name==='m01001.wav'),match:files.filter(f=>f.name!=='m01001.wav')},'library');
        tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);});db.close();
    });
    for(const [bots,winner,scene,name] of [[0,'peer','win','m01017'],[1,'human','win','m01017'],[1,'bot','loss','m01018']]) {
      await page.reload();await enterLocal(page,bots);
      await page.evaluate(winner=>window.__qaFinish(winner),winner);
      await localTrack(page,scene,name);
      assert.equal(await page.locator('#music-playlist').isVisible(),false);
    }
    // One identical render after the ending expires must not restart the track.
    await page.locator('#music-player').evaluate(a=>{a.currentTime=a.duration-.08;});
    await page.waitForFunction(()=>document.querySelector('#music-player').ended);
    await page.evaluate(()=>window.__qaRedraw());
    assert.equal(await page.locator('#music-player').evaluate(a=>a.paused),true);
    console.log('PASS Imported ending catalog, legacy IndexedDB refresh, hot-seat victory, human win/loss and one-shot playback');
  }finally{await context.close();}
}

const fixtureFooter = `
const nearVictory=${nearVictory.toString()};
(window as any).__qaRedraw=()=>render();
(window as any).__qaFinish=(winner:'human'|'bot'|'peer')=>{
 if (!state||remote)throw new Error('Local game required.');
 const id=state.players.find(p=>winner==='bot'?localBotIds.has(p.id):winner==='peer'?p.id!==viewer:!localBotIds.has(p.id))!.id;
 const next=structuredClone(state);nearVictory(next,id,createIslandBoard(next.board.layout));state=next;
 commit(localEconomy(next,{type:'claim-victory',playerId:id}),'Claimed victory.');
};
`;

// Only the fixture substitutes the relay. App snapshots, production HostSession
// routing, real host AudioWorklets and the guests' Web Audio schedulers all run.
const networkEntry = `const network=((callbacks:Parameters<typeof initializeNetwork>[0])=>{
  (window as any).__qaCallbacks=callbacks;
  const real=initializeNetwork(callbacks), send=(...args:any[])=>(window as any).__qaWire?.(...args);
  real.setMusicSharing=enabled=>send('share',enabled);
  real.setMusicListening=enabled=>send('listen',enabled);
  real.publishMusicFrame=(data,bus='table')=>send('frame',data,bus);
  real.resetMusicPlayback=(bus='table')=>send('reset',bus);
  return real;
})(`;

function measureScheduledAudio() {
  window.__qaHeard=[];
  const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args) {
    const b=this.buffer;
    if(b?.length===3600 && b.sampleRate===24000) {
      const data=b.getChannelData(0);let crossings=0,amplitude=0;
      for(let i=1;i<data.length;i++) {
        amplitude=Math.max(amplitude,Math.abs(data[i]));
        if(data[i-1]<=0&&data[i]>0)crossings++;
      }
      if(amplitude>.005)window.__qaHeard.push(crossings*b.sampleRate/b.length);
    }
    return start.apply(this,args);
  };
}
async function onlineChecks(browser, folder) {
  const ids={host:'Player 1',winner:'Player 2',loser:'Player 3',watcher:'Spectator'};
  const pages={}, listeners={}, pending={}, errors=[];
  let session, closed=false;
  // Per-peer ordering mirrors the room relay; late packets are ignored after teardown.
  function post(peer,callback,...args) {
    if(closed)return;
    pending[peer]=(pending[peer]??Promise.resolve()).then(()=>pages[peer].evaluate(
      ({callback,args})=>window.__qaCallbacks[callback](...args),{callback,args})).catch(error=>{if(!closed)errors.push(error.message);});
  }
  function send(peer,text) {
    const msg=JSON.parse(text);
    if(isRoomMusicMessage(msg))queueMicrotask(()=>listeners[peer]?.receive(msg));
    else if(msg.type==='snapshot')post(peer,'snapshot',msg.data,ids[peer]);
    return true;
  }
  function publish(msg) {
    if(msg.type==='snapshot')post('host','snapshot',msg.data,ids.host);
    if(msg.type==='music-subscribers')post('host','musicSubscribers',msg.data,msg.bus);
  }
  try {
    for(const [peer,id] of Object.entries(ids)) {
      const page=await browser.newPage({viewport:{width:900,height:750}});
      pages[peer]=page;page.on('pageerror',e=>{if(!closed)errors.push(e.message);});
      await page.addInitScript(measureScheduledAudio);
      await page.exposeFunction('__qaWire',(event,arg,bus)=>{
        if(!session||closed)return;
        if(peer==='host') {
          if(event==='share'){post('host','musicState',{role:'host',offered:arg});session.setMusicSharing(arg);}
          if(event==='frame')session.publishMusicFrame(arg,bus);
          if(event==='reset')session.resetMusicPlayback(arg);
        } else if(event==='listen')listeners[peer].setListening(arg);
      });
      await page.goto(url);
      if(peer==='host') {
        await importFolder(page,folder);
        post(peer,'musicState',{role:'host',offered:false});
      } else {
        listeners[peer]=new RoomMusicGuest(text=>session.receive(peer,text),{
          availability:offered=>post(peer,'musicState',{role:'guest',offered}),
          frame:(base64,seq,generation)=>post(peer,'musicFrame',{base64,seq,generation}),
          reset:()=>post(peer,'musicReset')
        });
        post(peer,'musicState',{role:'guest',offered:false});
      }
      await page.locator('#music-controls summary').click();
    }
    const players=[ids.host,ids.winner,ids.loser];
    const state=createGame(7,players);
    nearVictory(state,ids.winner,createIslandBoard(state.board.layout));
    const recovery={version:1,qaTwoPlayers:false,boardLayout:'standard',
      authority:new HostAuthority(gameId,state,()=>0).checkpoint(),
      seats:players.map((id,i)=>({id,name:id,token:i?String(i).repeat(43):''}))};
    session=HostSession.fromRecovery(send,publish,()=> 'z'.repeat(43),()=>0,recovery);
    for(const [peer,token] of [['winner',recovery.seats[1].token],['loser',recovery.seats[2].token]]) {
      session.receive(peer,JSON.stringify({protocol:1,type:'hello',token}));
    }
    session.receive('watcher',JSON.stringify({protocol:1,type:'hello',role:'spectator'}));
    session.resume(recovery);
    await pages.host.waitForFunction(()=>document.querySelector('#music-player').dataset.scene==='match');
    await pages.host.locator('#music-share-room').check();
    const guestPeers=['winner','loser','watcher'];
    await Promise.all(guestPeers.map(id=>pages[id].waitForFunction(()=>window.__qaHeard.some(hz=>hz>310&&hz<375),
      undefined,{timeout:16000})));
    for(const id of guestPeers)await pages[id].evaluate(()=>{window.__qaHeard.length=0;});
    const envelope=JSON.stringify({protocol:1,gameId,revision:0,sender:ids.winner,commandId:'claim',
      command:{type:'claim-victory',playerId:ids.winner}});
    session.receive('winner',JSON.stringify({protocol:1,type:'command',command:envelope}));
    await localTrack(pages.host,'loss','m01018');
    const heard=(target)=>window.__qaHeard.some(hz=>Math.abs(hz-target)<18);
    await Promise.all([[pages.winner,550],[pages.loser,750]].map(([page,hz])=>
      page.waitForFunction(heard,hz,{timeout:16000})));
    for(const [who,wrong] of [['winner',750],['loser',550]]) {
      assert.equal(await pages[who].evaluate(heard,wrong),false,who+' must hear only their own outcome');
    }
    assert.equal(await pages.watcher.evaluate(()=>window.__qaHeard.some(hz=>hz>500)),false,'spectators receive no personal ending');
    assert.deepEqual(errors,[]);
    console.log('PASS Shared host-only files decode as separate winner/loser tones on real guest audio schedulers; spectators hear neither ending');
  } finally {closed=true;await Promise.all(Object.values(pages).map(page=>page.close()));}
}

const folder=await mkdtemp(join(tmpdir(),'hex-end-audio-'));
let server,browser;
try {
  await Promise.all(names.map((name,i)=>writeFile(join(folder,name+'.wav'),wav(tones[i]))));
  const source=await readFile('src/game-ui.ts','utf8'),entry='const network=initializeNetwork(';
  assert.ok(source.includes(entry));
  await writeFile(sourcePath,source.replace(entry,networkEntry)+fixtureFooter);
  const html=(await readFile('index.html','utf8')).replace('/src/game-ui.ts','/'+sourcePath);
  assert.ok(html.includes(sourcePath));await writeFile(htmlPath,html);
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4187','--strictPort'],{stdio:'ignore'});
  let running=false;
  for(let n=0;n<90&&!running;n++){try{running=(await fetch(url)).ok;}catch{}if(!running)await delay(150);}
  assert.ok(running,'local audio fixture served');
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  await localChecks(browser,folder);
  await onlineChecks(browser,folder);
} finally {
  if(browser)await browser.close();server?.kill('SIGTERM');
  await Promise.all([rm(sourcePath,{force:true}),rm(htmlPath,{force:true}),rm(folder,{recursive:true,force:true})]);
}
