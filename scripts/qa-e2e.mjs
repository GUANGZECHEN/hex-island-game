import { chromium } from 'playwright';

const qaUrl=process.env.QA_URL;
const signalingUrl=process.env.QA_SIGNALING_URL;
if(!qaUrl)throw new Error('QA_URL is required.');
if(!signalingUrl)throw new Error('QA_SIGNALING_URL is required.');

const browser=await chromium.launch({headless:true});
const hostContext=await browser.newContext();
const guestContext=await browser.newContext();
const spectatorContext=await browser.newContext();
for(const context of [hostContext,guestContext,spectatorContext])await context.addInitScript(()=>{globalThis.__hexVisualMessageCount=0;const send=WebSocket.prototype.send;WebSocket.prototype.send=function(...args){globalThis.__hexVisualMessageCount++;return send.apply(this,args);};});

const host=await hostContext.newPage();
const guest=await guestContext.newPage();
const spectator=await spectatorContext.newPage();

try{
  // First prove that an invite survives the host-unavailable window instead of failing once.
  await host.goto(qaUrl,{waitUntil:'networkidle'});
  await host.getByRole('button',{name:'Create room'}).click();
  await host.waitForFunction(()=>((document.querySelector('#room-invite'))?.value??'').length>0);
  const retryInvite=await host.locator('#room-invite').inputValue();
  const retryHost=await host.evaluate(()=>{
    try{return JSON.parse(localStorage.getItem('hex-room-recovery-v1')??'null');}catch{return null;}
  });
  if(!retryHost||retryHost.role!=='host'||typeof retryHost.room!=='string'||typeof retryHost.capability!=='string')throw new Error('Could not read host recovery capability for first-join QA.');

  await host.goto('about:blank');
  await new Promise(resolve=>setTimeout(resolve,750));
  await spectator.goto(retryInvite,{waitUntil:'domcontentloaded'});
  if(await spectator.locator('#room-create').isVisible())throw new Error('Invite page exposed Create room.');
  if(await spectator.locator('#new-game').isVisible())throw new Error('Invite page exposed local game controls.');
  if(await spectator.locator('#home-intro').isVisible())throw new Error('Invite page exposed home/diagnostic links.');
  if(await spectator.locator('#room-reconnect').isVisible())throw new Error('Invite page exposed manual rejoin control.');
  if(await spectator.locator('#qa-indicator').isVisible())throw new Error('Invite page exposed QA-only copy.');
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('temporarily unavailable'),null,{timeout:15000});
  if(!(await spectator.locator('#room-ready').isDisabled()))throw new Error('Ready was enabled before a player seat was assigned.');

  const rawHostPage=await hostContext.newPage();
  await rawHostPage.goto(qaUrl,{waitUntil:'domcontentloaded'});
  await rawHostPage.evaluate(({endpoint,room,token})=>new Promise((resolve,reject)=>{
    const url=new URL(`${endpoint}/rooms/${room}/socket`);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);
    const timer=setTimeout(()=>reject(new Error('Raw host reconnect timed out.')),10000);
    ws.onerror=()=>{clearTimeout(timer);reject(new Error('Raw host reconnect failed.'));};
    ws.onmessage=event=>{
      let msg;try{msg=JSON.parse(String(event.data));}catch{return;}
      if(msg.type==='authenticate')ws.send(JSON.stringify({type:'auth',role:'host',token}));
      else if(msg.type==='ready'){clearTimeout(timer);globalThis.__hexRawHost=ws;resolve(true);}
      else if(msg.type==='error'){clearTimeout(timer);reject(new Error(`Raw host rejected: ${String(msg.code)}`));}
    };
  }),{endpoint:signalingUrl,room:retryHost.room,token:retryHost.capability});
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Cloudflare room connected'),null,{timeout:30000});
  if(!(await spectator.locator('#room-ready').isDisabled()))throw new Error('Retry probe unexpectedly assigned a game seat without a host session.');
  await spectator.goto('about:blank');
  await rawHostPage.close();

  // Create the real game after the retry probe.
  await host.goto(qaUrl,{waitUntil:'networkidle'});
  await host.locator('#room-seed').fill('24680');
  await host.waitForFunction(()=>document.querySelectorAll('#room-map-preview [data-hex-id]').length===19);
  await host.getByRole('button',{name:'Create room'}).click();
  await host.locator('#room-invite').waitFor({state:'visible'});
  await host.waitForFunction(()=>((document.querySelector('#room-invite'))?.value??'').length>0);
  const invite=await host.locator('#room-invite').inputValue();

  await guest.goto(invite,{waitUntil:'domcontentloaded'});
  if(await guest.locator('#room-create').isVisible())throw new Error('Invite page exposed Create room.');
  if(await guest.locator('#new-game').isVisible())throw new Error('Invite page exposed local game controls.');
  if(await guest.locator('#home-intro').isVisible())throw new Error('Invite page exposed home/diagnostic links.');
  if(await guest.locator('#room-reconnect').isVisible())throw new Error('Invite page exposed manual rejoin control.');
  await host.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 2: connected'),null,{timeout:30000});
  await guest.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 2: connected'),null,{timeout:30000});
  if(!(await guest.locator('#room-ready').isEnabled()))throw new Error('Ready stayed disabled after Player 2 joined.');

  // Nicknames are display-only and can be changed before start.
  await host.locator('#room-nickname').fill('Alice');
  await host.getByRole('button',{name:'Use nickname'}).click();
  await guest.locator('#room-nickname').fill('Bob');
  await guest.getByRole('button',{name:'Use nickname'}).click();
  await host.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Alice: connected')&&document.querySelector('#lobby')?.textContent?.includes('Bob: connected'),null,{timeout:10000});
  await guest.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Alice: connected')&&document.querySelector('#lobby')?.textContent?.includes('Bob: connected'),null,{timeout:10000});
  await host.locator('#room-nickname').fill('Player 1');
  await host.getByRole('button',{name:'Use nickname'}).click();
  await guest.locator('#room-nickname').fill('Player 2');
  await guest.getByRole('button',{name:'Use nickname'}).click();
  await host.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 1: connected')&&document.querySelector('#lobby')?.textContent?.includes('Player 2: connected'),null,{timeout:10000});

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
  if(await observer.locator('#board [data-building-kind="settlement"]').count()<1)throw new Error('B3 settlement icon did not render on the board.');
  if(await observer.locator('#board circle.game-building, #board rect.game-building').count()!==0)throw new Error('Legacy circle/rect building marker returned.');
  await spectator.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),guestRevision+1,{timeout:15000});
  await spectator.waitForFunction(()=>document.querySelector('#public-action')?.textContent?.includes('Player 2 built a settlement'),null,{timeout:15000});
  const beforeRoadHighlight=await actor.evaluate(()=>globalThis.__hexVisualMessageCount);
  await actor.getByRole('button',{name:'Place road',exact:true}).click();
  if(await actor.locator('[data-legal-target="road"]').count()<1)throw new Error('No legal road targets were highlighted.');
  if(await actor.evaluate(()=>globalThis.__hexVisualMessageCount)!==beforeRoadHighlight)throw new Error('Road highlighting sent a network message.');

  // Client-only layout checks keep the established reconnect test above intact.
  await actor.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),guestRevision+1,{timeout:15000});
  for(const width of [320,375,900,1024,1280,1600]){
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
    const responsive=await actor.evaluate(()=>{
      const main=document.querySelector('main')?.getBoundingClientRect();
      const board=document.querySelector('.board-panel')?.getBoundingClientRect();
      const controls=document.querySelector('.control-panel')?.getBoundingClientRect();
      const strip=document.querySelector('.board-stage #player-strip');
      return {
        mainWidth:main?.width??0,
        boardWidth:board?.width??0,
        boardTop:board?.top??0,
        boardBottom:board?.bottom??0,
        controlWidth:controls?.width??0,
        controlTop:controls?.top??0,
        stripPosition:strip?getComputedStyle(strip).position:'',
      };
    });
    if(width>=1200){
      if(responsive.mainWidth<1000)throw new Error(`Invite game stayed artificially narrow at ${width}px: main ${responsive.mainWidth}.`);
      if(responsive.boardWidth<520)throw new Error(`Desktop board column is too narrow at ${width}px: ${responsive.boardWidth}.`);
      if(Math.abs(responsive.boardTop-responsive.controlTop)>40)throw new Error(`Desktop panels did not stay side-by-side at ${width}px.`);
      if(responsive.stripPosition!=='absolute')throw new Error(`Desktop player HUD did not use board-corner layout at ${width}px.`);
    } else {
      if(responsive.controlTop<responsive.boardBottom-4)throw new Error(`Stacked control panel overlapped the board at ${width}px.`);
      if(Math.abs(responsive.boardWidth-responsive.controlWidth)>12)throw new Error(`Stacked panels have mismatched widths at ${width}px.`);
      if(responsive.stripPosition!=='static')throw new Error(`Player HUD did not move above the board at ${width}px.`);
    }
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
