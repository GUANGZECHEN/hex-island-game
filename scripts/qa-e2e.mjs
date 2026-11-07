import { chromium } from 'playwright';

const qaUrl=process.env.QA_URL;
if(!qaUrl)throw new Error('QA_URL is required.');

const browser=await chromium.launch({headless:true});
const hostContext=await browser.newContext();
const guestContext=await browser.newContext();
const host=await hostContext.newPage();
const guest=await guestContext.newPage();

try{
  await host.goto(qaUrl,{waitUntil:'networkidle'});
  await host.getByRole('button',{name:'Create room'}).click();
  await host.locator('#room-invite').waitFor({state:'visible'});
  await host.waitForFunction(()=>((document.querySelector('#room-invite'))?.value??'').length>0);
  const invite=await host.locator('#room-invite').inputValue();

  await guest.goto(invite,{waitUntil:'domcontentloaded'});
  await host.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 2: connected'));
  await guest.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 2: connected'));

  await host.getByRole('button',{name:'Mark ready'}).click();
  await guest.getByRole('button',{name:'Mark ready'}).click();
  await host.getByRole('button',{name:'Start multiplayer game'}).waitFor({state:'visible'});
  await host.waitForFunction(()=>!(document.querySelector('#room-start'))?.disabled);
  await host.getByRole('button',{name:'Start multiplayer game'}).click();

  await host.locator('#game').waitFor({state:'visible'});
  await guest.locator('#game').waitFor({state:'visible'});
  await guest.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'));

  // Trigger the same authenticated WebSocket close/reconnect path deterministically.
  const injected=await guest.evaluate(()=>{
    const hook=globalThis.__hexQaDropRoomConnection;
    if(typeof hook!=='function')return false;
    hook();
    return true;
  });
  if(!injected)throw new Error('QA reconnect hook was unavailable.');
  await guest.waitForFunction(()=>{
    const count=globalThis.__hexQaReconnectCount?.()??0;
    return count>=1;
  },null,{timeout:20000});
  await guest.waitForFunction(()=>{
    const status=document.querySelector('#network-status')?.textContent??'';
    return status.includes('Connected as Player 2') || status.includes('reconnected');
  },null,{timeout:20000});
  await guest.locator('#game').waitFor({state:'visible'});
  await guest.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'));

  // Cover the Product Owner's manual fallback too. Reload immediately, then reclaim
  // the same room and seat from sessionStorage while the old leave may still race in.
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.getByRole('button',{name:'Rejoin previous room'}).click();
  await guest.waitForFunction(()=>{
    const status=document.querySelector('#network-status')?.textContent??'';
    return status.includes('Connected as Player 2');
  },null,{timeout:20000});
  await guest.locator('#game').waitFor({state:'visible'});
  await guest.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'));

  // Starting seat is game data, so act from whichever browser owns the current turn.
  const hostTurn=(await host.locator('#game-status').textContent())?.includes("Player 1's turn")??false;
  const guestTurn=(await guest.locator('#game-status').textContent())?.includes("Player 2's turn")??false;
  if(hostTurn===guestTurn)throw new Error('Could not identify exactly one active setup player after reconnect.');

  const actor=hostTurn?host:guest;
  const observer=hostTurn?guest:host;
  await actor.getByRole('button',{name:'Place settlement'}).click();
  await actor.locator('#targets select').first().selectOption({index:0});
  await actor.getByRole('button',{name:'Use target'}).click();
  await observer.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 1'),null,{timeout:15000});

  console.log('E2E passed: create/join/ready/start, forced guest WebSocket disconnect, automatic reconnect, manual rejoin, seat resync and post-recovery revision update.');
} finally {
  await guestContext.close();
  await hostContext.close();
  await browser.close();
}
