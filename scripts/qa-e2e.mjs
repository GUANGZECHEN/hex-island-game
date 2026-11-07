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

  // Simulate a real transient guest network interruption while leaving the page open.
  await guestContext.setOffline(true);
  await new Promise(resolve=>setTimeout(resolve,250));
  await guestContext.setOffline(false);

  await guest.waitForFunction(()=>{
    const status=document.querySelector('#network-status')?.textContent??'';
    return status.includes('reconnected') || status.includes('Connected as Player 2');
  },null,{timeout:20000});
  await guest.locator('#game').waitFor({state:'visible'});

  // Verify state sync still works after the reconnect.
  await host.getByRole('button',{name:'Place settlement'}).click();
  await host.locator('#targets select').first().selectOption({index:0});
  await host.getByRole('button',{name:'Use target'}).click();
  await guest.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 1'),null,{timeout:15000});

  console.log('E2E passed: create/join/ready/start, guest reconnect, seat resync and post-reconnect state update.');
} finally {
  await guestContext.close();
  await hostContext.close();
  await browser.close();
}
