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

  // Force a real guest transport interruption while leaving both game pages open.
  await guestContext.setOffline(true);
  await guest.waitForFunction(()=>{
    const status=document.querySelector('#network-status')?.textContent??'';
    return status.includes('interrupted') || status.includes('Reconnecting');
  },null,{timeout:10000});

  await guestContext.setOffline(false);
  await guest.waitForFunction(()=>{
    const status=document.querySelector('#network-status')?.textContent??'';
    return status.includes('reconnected') || status.includes('Connected as Player 2');
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

  console.log('E2E passed: create/join/ready/start, forced guest disconnect, automatic reconnect, seat resync and post-reconnect revision update.');
} finally {
  await guestContext.close();
  await hostContext.close();
  await browser.close();
}
