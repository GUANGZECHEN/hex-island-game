import { chromium } from 'playwright';

const qaUrl=process.env.QA_URL;
if(!qaUrl)throw new Error('QA_URL is required.');

const browser=await chromium.launch({headless:true});
const hostContext=await browser.newContext();
const guestContext=await browser.newContext();
for(const context of [hostContext,guestContext])await context.addInitScript(()=>{globalThis.__hexVisualMessageCount=0;const send=WebSocket.prototype.send;WebSocket.prototype.send=function(...args){globalThis.__hexVisualMessageCount++;return send.apply(this,args);};});

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
  try {
    await guest.waitForFunction(()=>{
      const status=document.querySelector('#network-status')?.textContent??'';
      return status.includes('Connected as Player 2');
    },null,{timeout:20000});
  } catch {
    const info=await guest.evaluate(()=>{
      const text=(document.querySelector('#network-status')?.textContent??'').toLowerCase();
      return {reconnecting:text.includes('reconnect'),connected:text.includes('connected'),paused:text.includes('paused'),failed:text.includes('fail'),unavailable:text.includes('unavailable'),gameVisible:!(document.querySelector('#game')?.hidden)};
    });
    console.error('Manual rejoin status categories:',JSON.stringify(info));
    throw new Error('Manual rejoin did not restore the guest seat.');
  }
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

  // Client-only layout checks keep the established reconnect test above intact.
  await actor.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 1'),null,{timeout:15000});
  for(const width of [320,375,1280]){
    await actor.setViewportSize({width,height:900});
    if(await actor.locator('#hand [data-resource-icon]').count()!==5)throw new Error(`Resource icons missing at ${width}px.`);
    if(await actor.locator('[data-hex-id] [data-resource-icon]').count()!==18)throw new Error(`Tile icons missing at ${width}px.`);
    if(await actor.locator('[data-hex-id][data-resource]:not([data-resource="none"]) text.island-label').count()!==0)throw new Error(`Resource tiles still show terrain labels at ${width}px.`);
    if(await actor.locator('#board ul[aria-label="Island terrain and number tokens"] li').count()!==19)throw new Error('Accessible tile descriptions are missing.');
    if(await actor.getByRole('button',{name:'Place road',exact:true}).count()!==1)throw new Error('Expected one primary setup action.');
    if(await actor.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`Page overflow at ${width}px.`);
    const before=await actor.evaluate(()=>globalThis.__hexVisualMessageCount);
    await actor.locator('[data-panel="cards"]').click();
    await actor.locator('[data-panel="trade"]').click();
    await actor.locator('[data-panel="status"]').click();
    await actor.locator('[data-panel="actions"]').click();
    if(await actor.evaluate(()=>globalThis.__hexVisualMessageCount)!==before)throw new Error('Visual tabs sent a network message.');
  }

  console.log('E2E passed: create/join/ready/start, forced guest WebSocket disconnect, automatic reconnect, manual rejoin, seat resync and post-recovery revision update.');
} finally {
  await guestContext.close();
  await hostContext.close();
  await browser.close();
}
