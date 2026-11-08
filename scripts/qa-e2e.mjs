import { chromium } from 'playwright';

const qaUrl=process.env.QA_URL;
if(!qaUrl)throw new Error('QA_URL is required.');

const browser=await chromium.launch({headless:true});
const hostContext=await browser.newContext();
const guestContext=await browser.newContext();
const spectatorContext=await browser.newContext();
for(const context of [hostContext,guestContext,spectatorContext])await context.addInitScript(()=>{globalThis.__hexVisualMessageCount=0;const send=WebSocket.prototype.send;WebSocket.prototype.send=function(...args){globalThis.__hexVisualMessageCount++;return send.apply(this,args);};});

const host=await hostContext.newPage();
const guest=await guestContext.newPage();
const spectator=await spectatorContext.newPage();

try{
  await host.goto(qaUrl,{waitUntil:'networkidle'});
  await host.locator('#room-seed').fill('24680');
  await host.waitForFunction(()=>document.querySelectorAll('#room-map-preview [data-hex-id]').length===19);
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
  await host.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Seed 24680'));
  await guest.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'));

  await spectator.goto(invite,{waitUntil:'domcontentloaded'});
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Watching live game as spectator'),null,{timeout:20000});
  await spectator.locator('#game').waitFor({state:'visible',timeout:20000});
  await spectator.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'),null,{timeout:20000});
  if(!(await spectator.locator('#private-hand-card').getAttribute('hidden'))&&await spectator.locator('#private-hand-card').isVisible())throw new Error('Spectator private hand was visible.');
  if(await spectator.locator('#game-tabs').isVisible())throw new Error('Spectator action tabs were visible.');
  if(await spectator.locator('#room-ready').isVisible())throw new Error('Spectator ready control was visible.');
  if(await spectator.locator('#player-strip .player-summary').count()!==2)throw new Error('Spectator did not receive public player state.');

  const placeSetupPair=async(actor,observer,startRevision)=>{
    await actor.getByRole('button',{name:'Place settlement'}).click();
    if(await actor.locator('[data-legal-target="settlement"]').count()<1)throw new Error('No legal settlement targets were highlighted.');
    await actor.getByRole('button',{name:'Cancel selection'}).click();
    if(await actor.locator('[data-legal-target="settlement"]').count()!==0)throw new Error('Cancel selection left settlement targets active.');
    await actor.getByRole('button',{name:'Place settlement'}).click();
    await actor.locator('#targets select').first().selectOption({index:0});
    await actor.getByRole('button',{name:'Use target'}).click();
    await observer.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),startRevision+1,{timeout:15000});
    await actor.getByRole('button',{name:'Place road',exact:true}).click();
    if(await actor.locator('[data-legal-target="road"]').count()<1)throw new Error('No legal road targets were highlighted.');
    await actor.locator('#targets select').first().selectOption({index:0});
    await actor.getByRole('button',{name:'Use target'}).click();
    await observer.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),startRevision+2,{timeout:15000});
  };

  // Reproduce the Product Owner failure mode with Player 2 actively owning the turn.
  const hostStarts=(await host.locator('#game-status').textContent())?.includes("Player 1's turn")??false;
  if(hostStarts)await placeSetupPair(host,guest,0);
  await guest.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes("Player 2's turn"),null,{timeout:15000});
  await host.waitForFunction(()=>document.querySelector('#turn-hint')?.textContent?.includes('Waiting for Player 2'),null,{timeout:15000});
  await guest.waitForFunction(()=>document.querySelector('#turn-hint')?.textContent?.includes('Your turn'),null,{timeout:15000});
  const revisionBeforeDrop=Number((await guest.locator('#game-status').textContent())?.match(/Revision (\d+)/)?.[1]??'-1');
  if(revisionBeforeDrop<0)throw new Error('Could not read revision before reconnect test.');

  const injected=await guest.evaluate(()=>{
    const hook=globalThis.__hexQaDropRoomConnection;
    if(typeof hook!=='function')return false;
    hook();
    return true;
  });
  if(!injected)throw new Error('QA reconnect hook was unavailable.');
  // Race a manual Rejoin immediately against automatic reconnect, matching the reported real-world path.
  await guest.getByRole('button',{name:'Rejoin previous room'}).click();
  await guest.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Connected as Player 2'),null,{timeout:20000});
  await guest.waitForFunction(()=>document.querySelector('#game')?.getAttribute('aria-busy')==='false',null,{timeout:20000});
  await guest.waitForFunction(rev=>{
    const text=document.querySelector('#game-status')?.textContent??'';
    const match=text.match(/Revision (\d+)/);
    return !!match&&Number(match[1])>=rev&&text.includes("Player 2's turn");
  },revisionBeforeDrop,{timeout:20000});
  await host.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes("Player 2's turn"),null,{timeout:15000});
  await guest.waitForFunction(()=>document.querySelector('#turn-hint')?.textContent?.includes('Your turn'),null,{timeout:15000});
  await host.waitForFunction(()=>document.querySelector('#turn-hint')?.textContent?.includes('Waiting for Player 2'),null,{timeout:15000});

  const hostRevision=Number((await host.locator('#game-status').textContent())?.match(/Revision (\d+)/)?.[1]??'-1');
  const guestRevision=Number((await guest.locator('#game-status').textContent())?.match(/Revision (\d+)/)?.[1]??'-1');
  if(hostRevision!==guestRevision)throw new Error(`Reconnect revision mismatch: host ${hostRevision}, guest ${guestRevision}.`);

  const actor=guest;
  const observer=host;
  const visualBeforeTarget=await actor.evaluate(()=>globalThis.__hexVisualMessageCount);
  await actor.getByRole('button',{name:'Place settlement'}).click();
  if(await actor.locator('[data-legal-target="settlement"]').count()<1)throw new Error('No legal settlement targets were highlighted.');
  if(await actor.evaluate(()=>globalThis.__hexVisualMessageCount)!==visualBeforeTarget)throw new Error('Opening target mode sent a network message.');
  await actor.locator('#targets select').first().selectOption({index:0});
  await actor.getByRole('button',{name:'Use target'}).click();
  await observer.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),guestRevision+1,{timeout:15000});
  await observer.waitForFunction(()=>document.querySelector('#public-action')?.textContent?.includes('Player 2 built a settlement'),null,{timeout:15000});
  await observer.waitForFunction(()=>document.querySelector('#turn-banner')?.textContent?.includes('Player 2'),null,{timeout:15000});
  await spectator.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),guestRevision+1,{timeout:15000});
  await spectator.waitForFunction(()=>document.querySelector('#public-action')?.textContent?.includes('Player 2 built a settlement'),null,{timeout:15000});
  const beforeRoadHighlight=await actor.evaluate(()=>globalThis.__hexVisualMessageCount);
  await actor.getByRole('button',{name:'Place road',exact:true}).click();
  if(await actor.locator('[data-legal-target="road"]').count()<1)throw new Error('No legal road targets were highlighted.');
  if(await actor.evaluate(()=>globalThis.__hexVisualMessageCount)!==beforeRoadHighlight)throw new Error('Road highlighting sent a network message.');

  // Client-only layout checks keep the established reconnect test above intact.
  await actor.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),guestRevision+1,{timeout:15000});
  for(const width of [320,375,1280]){
    await actor.setViewportSize({width,height:900});
    if(await actor.locator('#hand [data-resource-icon]').count()!==5)throw new Error(`Resource icons missing at ${width}px.`);
    if(await actor.locator('#player-strip .player-summary').count()!==2)throw new Error(`Player summary missing at ${width}px.`);
    if(await actor.locator('#player-strip .active-player').count()!==1)throw new Error(`Active player highlight missing at ${width}px.`);
    if(await actor.locator('#player-strip .player-dev-count').count()!==2)throw new Error(`Development-card counts missing at ${width}px.`);
    if(await actor.locator('#player-strip .player-vp-count').count()!==2)throw new Error(`Public victory points missing at ${width}px.`);
    if(await actor.locator('.board-stage #player-strip').count()!==1)throw new Error(`Player HUD is not attached to the board at ${width}px.`);
    for(const selector of ['.player-road-left','.player-settlement-left','.player-city-left','.player-longest-road'])if(await actor.locator(`#player-strip ${selector}`).count()!==2)throw new Error(`Public piece/road status ${selector} missing at ${width}px.`);
    if(await actor.locator('#piece-supply .supply-settlement').count()!==1||await actor.locator('#piece-supply .supply-city').count()!==1)throw new Error(`Local building supply missing at ${width}px.`);
    if(!(await actor.locator('#turn-banner').textContent())?.includes('Player 2'))throw new Error(`Board turn banner missing at ${width}px.`);
    if(await actor.locator('#board [data-port-type] .port-connector').count()!==18)throw new Error(`Port connector lines missing at ${width}px.`);
    if(await actor.locator('#board [data-port-type]:not([data-port-type="generic"]) [data-resource-icon]').count()!==5)throw new Error(`Resource port icons missing at ${width}px.`);
    if(await actor.locator('#board [data-hex-id] [data-resource-icon]').count()!==18)throw new Error(`Tile icons missing at ${width}px.`);
    if(await actor.locator('#board [data-terrain-icon="desert"]').count()!==1)throw new Error(`Desert icon missing at ${width}px.`);
    if(await actor.locator('#board [data-robber-marker="true"]').count()!==1)throw new Error(`Robber prohibition marker missing at ${width}px.`);
    const robberOpacity=await actor.locator('#board .robber-occupied .island-cell').evaluate(node=>getComputedStyle(node).opacity);
    if(Number(robberOpacity)>=0.7)throw new Error(`Robber tile was not visibly dimmed at ${width}px.`);
    if(await actor.locator('#board [data-hex-id][data-resource]:not([data-resource="none"]) text.island-label').count()!==0)throw new Error(`Resource tiles still show terrain labels at ${width}px.`);
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

  const expectedRecoveryRevision=guestRevision+1;
  await spectator.close();
  await guest.close();
  await host.close();

  const hostRecovered=await hostContext.newPage();
  const guestRecovered=await guestContext.newPage();
  await hostRecovered.goto(qaUrl,{waitUntil:'domcontentloaded'});
  await hostRecovered.getByRole('button',{name:'Rejoin previous room'}).click();
  await hostRecovered.locator('#room-recovery-panel').waitFor({state:'visible',timeout:20000});
  await hostRecovered.waitForFunction(()=>document.querySelector('#room-recovery-status')?.textContent?.includes('Reconnect all original players'),null,{timeout:20000});

  await guestRecovered.goto(qaUrl,{waitUntil:'domcontentloaded'});
  await guestRecovered.getByRole('button',{name:'Rejoin previous room'}).click();
  await guestRecovered.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Seat restored as Player 2')&&document.querySelector('#network-status')?.textContent?.includes('Waiting for host to resume saved game'),null,{timeout:20000});
  await hostRecovered.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 2: connected'),null,{timeout:20000});
  await hostRecovered.waitForFunction(()=>Array.from(document.querySelectorAll('#room-recovery-options button')).some(button=>!button.disabled),null,{timeout:20000});

  const resumeLatest=hostRecovered.getByRole('button',{name:/Resume latest/});
  await resumeLatest.click();
  await hostRecovered.locator('#game').waitFor({state:'visible',timeout:20000});
  await guestRecovered.locator('#game').waitFor({state:'visible',timeout:20000});
  await hostRecovered.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),expectedRecoveryRevision,{timeout:20000});
  await guestRecovered.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),expectedRecoveryRevision,{timeout:20000});
  if(!(await hostRecovered.locator('#game-status').textContent())?.includes('Seed 24680'))throw new Error('Recovered host did not restore the selected map.');
  if(!(await guestRecovered.locator('#game-status').textContent())?.includes('Seed 24680'))throw new Error('Recovered guest did not restore the selected map.');

  console.log('E2E passed: active-turn reconnect, persistent host+guest credentials, full-page shutdown, all-player rejoin and saved-game resume at the authoritative revision.');
} finally {
  await spectatorContext.close();
  await guestContext.close();
  await hostContext.close();
  await browser.close();
}
