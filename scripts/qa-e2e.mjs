import {assertDirectTargets,boardTargetIds,boardTargetPoint,clickBoardTarget} from './qa-board-targets.mjs';
import { chromium } from 'playwright';

const baseQaUrl=process.env.QA_URL;
const fallbackUrl=baseQaUrl?new URL(baseQaUrl):null;if(fallbackUrl)fallbackUrl.searchParams.set('renderer','2d');
const qaUrl=fallbackUrl?.href;
const signalingUrl=process.env.QA_SIGNALING_URL;
if(!qaUrl)throw new Error('QA_URL is required.');
if(!signalingUrl)throw new Error('QA_SIGNALING_URL is required.');

const browser=await chromium.launch({headless:true});
const hostContext=await browser.newContext();
const guestContext=await browser.newContext();
const spectatorContext=await browser.newContext();
for(const context of [hostContext,guestContext,spectatorContext])await context.addInitScript(()=>{
  globalThis.__hexVisualMessageCount=0;
  globalThis.__hexHeartbeat={sent:[],received:[]};
  // Record only protocol categories and lifecycle metadata, never URLs,
  // message payloads, capabilities, peer IDs, or close reasons.
  const trace={events:[],nextSocket:0};
  globalThis.__hexSocketTrace=trace;
  const sockets=new Map(),endpoints=new Map();
  globalThis.__hexSocketSnapshot=()=>[...sockets].map(([socket,ws])=>({socket,readyState:ws.readyState}));
  const record=(socket,event,detail={})=>{
    if(trace.events.length>=100)trace.events.shift();
    trace.events.push({socket,event,...detail});
  };
  const frameType=value=>['authenticate','auth','ready','error','ping','pong','join','leave','relay','checkpoint-list','checkpoint-data','checkpoint-saved','checkpoint-cleared','checkpoint-error'].includes(value)?value:'other';
  const errorCode=value=>['invalid','expired','room-full','host-unavailable'].includes(value)?value:'other';
  const NativeWebSocket=WebSocket;
  globalThis.WebSocket=class extends NativeWebSocket{
    constructor(...args){
      super(...args);
      const socket=++trace.nextSocket;
      this.__hexTraceSocket=socket;
      sockets.set(socket,this);
      let endpoint=0;
      try{const origin=new URL(String(args[0])).origin;if(!endpoints.has(origin))endpoints.set(origin,endpoints.size+1);endpoint=endpoints.get(origin);}catch{}
      record(socket,'constructed',{endpoint});
      this.addEventListener('open',()=>record(socket,'open'));
      this.addEventListener('error',()=>record(socket,'error'));
      this.addEventListener('close',event=>record(socket,'closed',{code:event.code,clean:event.wasClean}));
      this.addEventListener('message',event=>{
        try{
          const frame=JSON.parse(String(event.data));
          record(socket,'received',{type:frameType(frame?.type),...(frame?.type==='error'?{code:errorCode(frame.code)}:{})});
          if(frame?.type==='pong')globalThis.__hexHeartbeat.received.push(frame.id);
        }catch{record(socket,'received',{type:'non-json'});}
      });
    }
    close(code,reason){record(this.__hexTraceSocket,'close-requested',{code:typeof code==='number'?code:null});return super.close(code,reason);}
  };
  const originalSend=WebSocket.prototype.send;
  WebSocket.prototype.send=function(...args){
    // Clock synchronization messages are not gameplay commands.
    // Only command relay frames should count as board-state changes.
    try{
      const wire=JSON.parse(args[0]);
      record(this.__hexTraceSocket,'sent',{type:frameType(wire?.type)});
      if(wire?.type==='ping')globalThis.__hexHeartbeat.sent.push(wire.id);
      if(wire?.type==='relay'){
        const inner=JSON.parse(wire.data);
        if(inner?.type==='command')globalThis.__hexVisualMessageCount++;
      }
    }catch{/* Invalid or non-JSON packets do not count as gameplay. */}
    return originalSend.apply(this,args);
  };
});

const host=await hostContext.newPage();
const guest=await guestContext.newPage();
const spectator=await spectatorContext.newPage();

async function assertRoomWorkspaceLayout(page,label){
 const measure=()=>page.evaluate(()=>{
  const box=(selector)=>{
   const node=document.querySelector(selector),r=node?.getBoundingClientRect();
   return r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;
  };
  const roomNode=document.querySelector('#room-section'),room=box('#room-section'),command=box('.board-command-column');
  return {
   gameVisible:!document.querySelector('#game')?.hidden,
   roomVisible:!!roomNode&&!!room&&!!command&&getComputedStyle(roomNode).display!=='none'&&room.width>0,
   player:box('.board-player-column'),map:box('.board-map-column'),command,room,
   roomSectionInsideCommand:roomNode?.parentElement===document.querySelector('.board-command-column')
  };
 });
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const desktop=await measure();
 if(!desktop.gameVisible||!desktop.roomVisible||!desktop.roomSectionInsideCommand||!desktop.player||!desktop.map||!desktop.command||!desktop.room||
    desktop.player.right>desktop.map.x+4||desktop.map.right>desktop.command.x+4||
    desktop.room.x<desktop.command.x-4||desktop.room.right>desktop.command.right+4){
  throw new Error(label+' desktop room lobby does not match the final player / map / command layout: '+JSON.stringify(desktop));
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const mobile=await measure();
 if(!mobile.gameVisible||!mobile.roomVisible||!mobile.player||!mobile.map||!mobile.command||!mobile.room||
    mobile.player.bottom>mobile.map.y+4||mobile.map.bottom>mobile.command.y+4||
    mobile.room.x<mobile.command.x-4||mobile.room.right>mobile.command.right+4){
  throw new Error(label+' mobile room lobby does not stack like the final game layout: '+JSON.stringify(mobile));
 }
 await page.setViewportSize({width:1280,height:900});
}

try{
  // Local-only deterministic bot range: one human plus up to five bots.
  await host.goto(qaUrl,{waitUntil:'networkidle'});
  if(await host.locator('#local-room-lobby').isVisible())throw new Error('Local map controls were exposed before creating a local room.');
  await host.getByRole('button',{name:'Create local room'}).click();
  await host.locator('#local-room-lobby').waitFor({state:'visible'});
  if(await host.locator('#local-map-preview [data-hex-id]').count()!==19)throw new Error('Local room initial preview did not show the standard map.');
  await host.locator('#local-bot-count').selectOption('4');
  if(await host.locator('#seats').inputValue()!=='5'||!(await host.locator('#seats').isDisabled()))throw new Error('Four-bot mode did not lock the game to five players.');
  if(await host.locator('#local-map-preview [data-hex-id]').count()!==24)throw new Error('Local room did not switch to expanded preview for five seats.');
  await host.locator('#local-bot-count').selectOption('5');
  if(await host.locator('#seats').inputValue()!=='6'||!(await host.locator('#seats').isDisabled()))throw new Error('Five-bot mode did not lock the game to six players.');
  await host.locator('#seed').fill('86420');
  await host.getByRole('button',{name:'Start game'}).click();
  await host.locator('#game').waitFor({state:'visible'});
  if(await host.locator('#player-strip .player-summary').count()!==6)throw new Error('Five-bot mode did not create six player cards.');
  if(await host.locator('#board [data-hex-id]').count()!==24)throw new Error('Five-bot mode did not automatically use the expanded board.');
  if(!(await host.locator('#connection-summary').textContent())?.includes('5 test bots enabled'))throw new Error('Five-bot mode status was missing.');
  if(!(await host.locator('#local-restart').isVisible()))throw new Error('Local restart was not available during an active bot game.');
  host.once('dialog',dialog=>dialog.accept());
  await host.locator('#local-restart').click();
  await host.locator('#game').waitFor({state:'visible'});
  if(await host.locator('#player-strip .player-summary').count()!==6)throw new Error('Local restart lost the five bots.');
  if(!(await host.locator('#game-status').textContent())?.includes('Seed 86420'))throw new Error('Local restart lost the selected room map.');
  if(await host.locator('#board [data-hex-id]').count()!==24)throw new Error('Local restart lost the expanded board.');
  if(await host.locator('#pass').isVisible()||await host.locator('#switch-player').isVisible())throw new Error('Five-bot mode exposed hot-seat controls.');

  // Restart with two bots for the deeper deterministic gameplay and visual smoke.
  await host.goto(qaUrl,{waitUntil:'networkidle'});
  await host.getByRole('button',{name:'Create local room'}).click();
  await host.locator('#local-bot-count').selectOption('2');
  if(await host.locator('#seats').inputValue()!=='3'||!(await host.locator('#seats').isDisabled()))throw new Error('Two-bot mode did not lock the game to three players.');
  await host.locator('#seed').fill('13579');
  await host.getByRole('button',{name:'Start game'}).click();
  await host.locator('#game').waitFor({state:'visible'});
  if(await host.locator('#pass').isVisible())throw new Error('Two-bot mode opened the pass-device screen.');
  if(await host.locator('#switch-player').isVisible())throw new Error('Two-bot mode exposed manual player switching.');
  if(!(await host.locator('#connection-summary').textContent())?.includes('2 test bots enabled'))throw new Error('Two-bot mode status was missing.');
  if(await host.locator('#player-strip .player-summary').count()!==3)throw new Error('Two-bot mode did not create three player cards.');
  if(await host.locator('#game-tabs').count()!==0)throw new Error('The obsolete navigation tabs are still rendered.');
  if(await host.locator('#board-action-pane').count()!==1||await host.locator('#board-trade-pane').count()!==1)throw new Error('Both board action regions are required.');
  if(await host.locator('#private-hand-card .resource-chip').count()!==5)throw new Error('ART-B01 hand does not expose five resource tokens.');
  const handClasses=await host.locator('#private-hand-card .resource-chip').evaluateAll(nodes=>nodes.map(node=>node.className));
  if(!['lumber','brick','wool','grain','ore'].every(resource=>handClasses.some(value=>String(value).includes(`resource-chip-${resource}`))))throw new Error(`ART-B01 resource-specific hand styling is incomplete: ${handClasses.join(' | ')}`);
  const handSurface=await host.locator('#private-hand-card').evaluate(node=>({background:getComputedStyle(node).backgroundImage,border:getComputedStyle(node).borderTopColor}));
  if(!handSurface.background||handSurface.background==='none')throw new Error('ART-B01 hand tray has no material surface.');
  if(await host.locator('#actions .action-button').count()&&await host.locator('#actions .action-button[class*="action-"]').count()!==await host.locator('#actions .action-button').count())throw new Error('ART-B01 action semantic styling is incomplete.');
  const placeHumanSetupPair=async()=>{
    await host.getByRole('button',{name:'Place settlement'}).click();
    await clickBoardTarget(host);
    await host.getByRole('button',{name:'Place road',exact:true}).click();
    await clickBoardTarget(host);
  };
  await host.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes("Player 1's turn; phase: setup-settlement"),null,{timeout:30000});
  await placeHumanSetupPair();
  await host.waitForFunction(()=>Array.from(document.querySelectorAll('#board [data-building-kind] title')).some(node=>node.textContent?.startsWith('Bot 1 settlement')),null,{timeout:15000});
  await host.waitForFunction(()=>Array.from(document.querySelectorAll('#board [data-building-kind] title')).some(node=>node.textContent?.startsWith('Bot 2 settlement')),null,{timeout:15000});
  if(await host.locator('#pass').isVisible())throw new Error('Bot turns triggered pass-device UI.');
  if(await host.locator('#board .board-ocean').count()!==1||await host.locator('#board .board-ocean-waves').count()!==1)throw new Error('ART-A01 ocean layers are missing.');
  const oceanPaint=await host.locator('#board .board-ocean').evaluate(node=>getComputedStyle(node).fill);
  if(!oceanPaint||oceanPaint==='none'||oceanPaint.includes('rgba(0, 0, 0, 0)'))throw new Error(`ART-A01 ocean is visually transparent: ${oceanPaint}`);
  for(const terrain of ['forest','hills','pasture','fields','mountains','desert']){
    const paint=await host.locator(`#board .island-cell-${terrain}`).first().evaluate(node=>getComputedStyle(node).fill);
    if(!paint||paint==='none'||paint.includes('rgba(0, 0, 0, 0)'))throw new Error(`ART-A01 ${terrain} tile has no visible fill: ${paint}`);
  }
  if(await host.locator('#board [data-terrain-art]').count()!==19)throw new Error('ART-A01 terrain illustration is incomplete.');
  if(await host.locator('#board [data-terrain="hills"] .terrain-art-clay-face').count()<1||await host.locator('#board [data-terrain="hills"] .terrain-art-brick').count()<3)throw new Error('Brick terrain does not show clay-quarry/brick-source art.');
  if(await host.locator('#board [data-terrain="mountains"] .terrain-art-rock-fill').count()<1||await host.locator('#board [data-terrain="mountains"] .terrain-art-rubble').count()<4)throw new Error('Ore terrain does not show exposed-rock/quarry art.');
  if(await host.locator('#board .island-cell-shadow').count()!==19||await host.locator('#board .island-cell-inset').count()!==19)throw new Error('ART-A01 tabletop hex layers are incomplete.');
  if(await host.locator('#board .island-token-pip').count()<10)throw new Error('ART-A01 number-token probability pips are missing.');
  if(await host.locator('#board .game-building-shadow').count()<2)throw new Error('ART-A01 solid building pieces are missing shadows.');
  const dockCount=await host.locator('#board .port-dock-board').count();
  if(dockCount!==9)throw new Error(`ART-FINAL expected 9 dock ports, found ${dockCount}.`);
  if(await host.locator('#board .port-pier-leg').count()!==18)throw new Error('ART-FINAL port dock legs do not preserve both coastal vertices.');
  const portLegGeometry=await host.locator('#board [data-port-type]').evaluateAll(groups=>groups.map(group=>{
    const legs=Array.from(group.querySelectorAll('.port-pier-leg'));
    if(legs.length!==2)return {split:false,lengthDelta:0};
    const values=legs.map(line=>({x1:Number(line.getAttribute('x1')),y1:Number(line.getAttribute('y1')),x2:Number(line.getAttribute('x2')),y2:Number(line.getAttribute('y2'))}));
    const split=Math.hypot(values[0].x2-values[1].x2,values[0].y2-values[1].y2)>.2;
    const lengths=values.map(v=>Math.hypot(v.x2-v.x1,v.y2-v.y1));
    return {split,lengthDelta:Math.abs(lengths[0]-lengths[1])};
  }));
  if(portLegGeometry.some(item=>!item.split))throw new Error(`ART-FINAL dock legs still converge on one endpoint: ${JSON.stringify(portLegGeometry)}`);
  if(!portLegGeometry.some(item=>item.lengthDelta>.02))throw new Error(`ART-FINAL dock placement did not create natural unequal leg lengths: ${JSON.stringify(portLegGeometry)}`);
  if(await host.locator('#board .port-pier-stem').count()!==0)throw new Error('ART-FINAL obsolete central dock stem is still rendered.');
  if(await host.locator('#board .port-badge').count()!==0)throw new Error('ART-FINAL old floating circular port badges are still rendered.');
  const dockPaint=await host.locator('#board .port-dock-board').first().evaluate(node=>getComputedStyle(node).fill);
  if(!dockPaint||dockPaint==='none'||dockPaint.includes('rgba(0, 0, 0, 0)'))throw new Error(`ART-FINAL dock is visually unpainted: ${dockPaint}`);
  if(await host.locator('#board .port-anchor-icon').count()!==0||await host.locator('#board .port-label-generic').count()<1||await host.locator('#board .port-resource-icon').count()<1)throw new Error('ART-FINAL generic text-only/resource port faces are incomplete.');
  const buildingPlacement=await host.locator('#board [data-building-kind]').evaluateAll(groups=>groups.map(group=>{
    const shell=group.querySelector('.game-building-shell'),svg=group.ownerSVGElement;
    if(!shell||!svg)return {visible:false,offset:999};
    const box=shell.getBoundingClientRect(),style=getComputedStyle(shell),x=Number(group.getAttribute('data-board-x')),y=Number(group.getAttribute('data-board-y')),point=svg.createSVGPoint();
    point.x=x;point.y=y;const matrix=svg.getScreenCTM();if(!matrix)return {visible:false,offset:999};const screen=point.matrixTransform(matrix);
    return {visible:box.width>=8&&box.height>=8&&style.fill!=='none'&&style.opacity!=='0',offset:Math.hypot((box.left+box.width/2)-screen.x,(box.top+box.height/2)-screen.y)};
  }));
  if(buildingPlacement.filter(item=>item.visible&&item.offset<18).length<2)throw new Error(`ART-A01 settlements are not visibly centered on their vertices: ${JSON.stringify(buildingPlacement)}`);
  await host.waitForFunction(()=>document.querySelectorAll('#board .game-road-piece').length>=2,null,{timeout:15000});
  const roadPieces=await host.locator('#board .game-road-piece').count();
  if(await host.locator('#board .game-road-shadow').count()!==roadPieces||await host.locator('#board .game-road-highlight').count()!==roadPieces)throw new Error('ART-A01 layered wooden roads are incomplete.');

  // Complete Player 1's second setup pair, then exercise a real authoritative dice roll.
  await host.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes("Player 1's turn; phase: setup-settlement"),null,{timeout:30000});
  await placeHumanSetupPair();
  await host.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes("Player 1's turn; phase: roll"),null,{timeout:30000});
  await host.getByRole('button',{name:'Roll dice'}).click();
  const diceOverlay=host.locator('#board .board-roll-overlay');
  await diceOverlay.waitFor({state:'visible',timeout:7000});
  const dice=await diceOverlay.locator('.board-rolled-die').evaluateAll(nodes=>nodes.map(node=>Number(node.getAttribute('data-value'))));
  if(dice.length!==2||dice.some(value=>!Number.isInteger(value)||value<1||value>6))throw new Error('The board did not show two real dice values.');
  const gameStatus=await host.locator('#game-status').textContent();
  if(!gameStatus?.includes(`dice ${dice[0]} + ${dice[1]}`))throw new Error('Dice shown on the board do not match the real game state.');
  const diceAnimation=await diceOverlay.locator('.board-rolled-die').first().evaluate(node=>getComputedStyle(node).animationName);
  if(!diceAnimation.includes('roll-board-die-drop'))throw new Error('On-board dice do not tumble: '+diceAnimation);
  if(await host.locator('#board .activity-alert.activity-dice').count())throw new Error('The old dice alert must not cover the board.');
  await host.waitForFunction(()=>!document.querySelector('#board .board-roll-overlay')||
    !!document.querySelector('#board .board-roll-overlay .board-roll-gain')||
    (document.querySelector('#board .board-roll-overlay')?.getAttribute('aria-label')||'').includes('equals 7'),null,{timeout:3500}).catch(()=>{});
  const gains=diceOverlay.locator('.board-roll-gain');
  const gainCount=await gains.count();
  if(gainCount&&await gains.locator('[data-resource-icon]').count()<gainCount)throw new Error('Building gains do not show resource icons.');

  await host.goto(qaUrl,{waitUntil:'networkidle'});

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
  await host.getByRole('button',{name:'Create room'}).click();
  await host.locator('#room-map-lobby').waitFor({state:'visible'});
  await host.locator('#game').waitFor({state:'visible'});
  if(!(await host.evaluate(()=>document.querySelector('#room-section')?.closest('.board-command-column')!==null&&document.querySelectorAll('#board [data-hex-id]').length===19)))throw new Error('Host did not enter the shared board workspace before starting.');
  await assertRoomWorkspaceLayout(host,'Host');
  await host.locator('#room-seed').fill('24680');
  await host.locator('#room-seed').dispatchEvent('change');
  await host.waitForFunction(()=>document.querySelectorAll('#room-map-preview [data-hex-id]').length===19);
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
  if(!(await guest.evaluate(()=>!document.querySelector('#game')?.hidden&&document.querySelector('#room-section')?.closest('.board-command-column')!==null&&document.querySelectorAll('#board [data-hex-id]').length===19)))throw new Error('Guest did not see the board directly inside the room.');
  await assertRoomWorkspaceLayout(guest,'Guest');
  await guest.waitForFunction(()=>document.querySelector('#room-seed')?.value==='24680',null,{timeout:10000});
  if(!(await guest.locator('#room-seed').isDisabled()))throw new Error('Guest can change the host-selected map.');
  if(await guest.locator('#room-map-preview [data-hex-id]').count()!==19)throw new Error('Guest did not receive a shared map preview.');
  await spectator.goto(invite,{waitUntil:'domcontentloaded'});
  await spectator.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Player 3: connected'),null,{timeout:15000});

  // A host transport loss with two actual guests used to interrupt cleanup
  // before reconnection. Both original seat credentials must still work.
  const reliabilityErrors=[];
  const reliabilityPages=[host,guest,spectator];
  const sanitizeDiagnostic=value=>String(value).replace(/(?:https?|wss?):\/\/[^\s)]+/gi,'[url]').replace(/[A-Za-z0-9_-]{20,}/g,'[redacted]').slice(0,300);
  const errorListeners=reliabilityPages.map((page,index)=>{
    const pageError=error=>reliabilityErrors.push(`${index}: pageerror: ${sanitizeDiagnostic(error.message)}`);
    const consoleError=message=>{if(message.type()==='error')reliabilityErrors.push(`${index}: console: ${sanitizeDiagnostic(message.text())}`);};
    page.on('pageerror',pageError);page.on('console',consoleError);
    return {page,pageError,consoleError};
  });
  const activeRoom=await host.evaluate(()=>JSON.parse(localStorage.getItem('hex-room-recovery-v1')??'null')?.room);
  if(typeof activeRoom!=='string')throw new Error('Could not identify the active room for seat verification.');
  const credentials=await Promise.all([guest,spectator].map(page=>page.evaluate(room=>localStorage.getItem(`hex-seat:${room}`),activeRoom)));
  if(credentials.some(value=>typeof value!=='string'||!value))throw new Error('Could not capture both original guest seat credentials.');
  const hostReconnectCount=await host.evaluate(()=>globalThis.__hexQaReconnectCount?.());
  if(!Number.isInteger(hostReconnectCount))throw new Error('Host QA reconnect hook was unavailable.');
  const immediatelyAfterDrop=await host.evaluate(()=>{globalThis.__hexQaDropRoomConnection();return globalThis.__hexSocketSnapshot();});
  try{
    await host.waitForFunction(count=>globalThis.__hexQaReconnectCount?.()>count,hostReconnectCount,{timeout:30000});
  }catch{
    const clients=await Promise.all(reliabilityPages.map(async(page,index)=>{
      try{
        const result=await page.evaluate(()=>({status:document.querySelector('#network-status')?.textContent??'',reconnects:globalThis.__hexQaReconnectCount?.()??null,sockets:globalThis.__hexSocketSnapshot(),trace:globalThis.__hexSocketTrace}));
        return {client:index,...result,status:sanitizeDiagnostic(result.status)};
      }catch{return {client:index,unavailable:true};}
    }));
    throw new Error(`Host reconnect timed out: ${JSON.stringify({initialHostReconnectCount:hostReconnectCount,immediatelyAfterDrop,clients,errors:reliabilityErrors})}`);
  }
  for(const page of reliabilityPages){
    await page.waitForFunction(()=>{
      const lobby=document.querySelector('#lobby')?.textContent??'';
      return ['Player 1: connected','Player 2: connected','Player 3: connected'].every(value=>lobby.includes(value));
    },null,{timeout:30000});
  }
  await guest.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Connected as Player 2'),null,{timeout:20000});
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Connected as Player 3'),null,{timeout:20000});
  const restoredCredentials=await Promise.all([guest,spectator].map(page=>page.evaluate(room=>localStorage.getItem(`hex-seat:${room}`),activeRoom)));
  if(JSON.stringify(restoredCredentials)!==JSON.stringify(credentials))throw new Error('Host reconnect changed an original guest seat credential.');
  await host.locator('#room-seed').fill('24681');
  await host.locator('#room-seed').dispatchEvent('change');
  for(const page of [guest,spectator])await page.waitForFunction(()=>document.querySelector('#room-seed')?.value==='24681',null,{timeout:15000});
  await host.locator('#room-seed').fill('24680');
  await host.locator('#room-seed').dispatchEvent('change');
  for(const page of [guest,spectator])await page.waitForFunction(()=>document.querySelector('#room-seed')?.value==='24680',null,{timeout:15000});

  // Pause immediately so the real 25-second heartbeat can be observed without
  // gameplay commands or the 45-second action deadline advancing the game.
  for(const page of reliabilityPages)await page.locator('#room-ready').click();
  await host.waitForFunction(()=>!document.querySelector('#room-start')?.disabled,null,{timeout:15000});
  await host.locator('#room-start').click();
  for(const page of reliabilityPages)await page.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'),null,{timeout:15000});
  await host.locator('#turn-clock-pause').click();
  for(const page of reliabilityPages)await page.waitForFunction(()=>document.querySelector('#turn-action-clock-player')?.textContent?.includes('Paused'),null,{timeout:15000});
  const paused=await Promise.all(reliabilityPages.map(page=>page.evaluate(()=>({
    seconds:document.querySelector('#turn-action-clock-seconds')?.textContent,
    status:document.querySelector('#game-status')?.textContent,
    commands:globalThis.__hexVisualMessageCount,
    sent:globalThis.__hexHeartbeat.sent.length,
    received:globalThis.__hexHeartbeat.received.length
  }))));
  await Promise.all(reliabilityPages.map((page,index)=>page.waitForFunction(before=>{
    const heartbeat=globalThis.__hexHeartbeat;
    return heartbeat.sent.slice(before.sent).some(id=>Number.isSafeInteger(id)&&id>=0&&heartbeat.received.slice(before.received).includes(id));
  },paused[index],{timeout:35000})));
  for(let index=0;index<reliabilityPages.length;index++){
    const after=await reliabilityPages[index].evaluate(()=>({seconds:document.querySelector('#turn-action-clock-seconds')?.textContent,status:document.querySelector('#game-status')?.textContent,commands:globalThis.__hexVisualMessageCount}));
    if(after.seconds!==paused[index].seconds||after.status!==paused[index].status||after.commands!==paused[index].commands)throw new Error(`Heartbeat changed paused game state on client ${index}: ${JSON.stringify({before:paused[index],after})}`);
  }
  await host.locator('#turn-clock-pause').click();
  await host.waitForFunction(()=>!document.querySelector('#turn-action-clock-player')?.textContent?.includes('Paused'),null,{timeout:15000});
  const running=await host.evaluate(()=>({
    at:performance.now(),seconds:Number(document.querySelector('#turn-action-clock-seconds')?.textContent?.slice(-2)),
    status:document.querySelector('#game-status')?.textContent,commands:globalThis.__hexVisualMessageCount,
    sent:globalThis.__hexHeartbeat.sent.length,received:globalThis.__hexHeartbeat.received.length
  }));
  await host.waitForFunction(before=>performance.now()-before.at>=5000&&globalThis.__hexHeartbeat.sent.slice(before.sent).some(id=>globalThis.__hexHeartbeat.received.slice(before.received).includes(id)),running,{timeout:35000});
  const runningAfter=await host.evaluate(()=>({at:performance.now(),seconds:Number(document.querySelector('#turn-action-clock-seconds')?.textContent?.slice(-2)),status:document.querySelector('#game-status')?.textContent,commands:globalThis.__hexVisualMessageCount}));
  const elapsed=(runningAfter.at-running.at)/1000;
  if(!Number.isFinite(running.seconds)||!Number.isFinite(runningAfter.seconds)||runningAfter.seconds>running.seconds-elapsed+2||runningAfter.status!==running.status||runningAfter.commands!==running.commands)throw new Error(`Heartbeat refreshed the running action clock or changed the game: ${JSON.stringify({before:running,after:runningAfter})}`);
  if(reliabilityErrors.length)throw new Error(`Browser errors during host reconnect/heartbeat: ${reliabilityErrors.join(' | ')}`);
  for(const {page,pageError,consoleError} of errorListeners){page.off('pageerror',pageError);page.off('console',consoleError);}
  host.once('dialog',dialog=>dialog.accept());
  await host.locator('#game-change-map').click();
  for(const page of reliabilityPages)await page.waitForFunction(()=>document.body.classList.contains('room-configuring')&&document.querySelector('#room-map-lobby')?.getClientRects().length>0,null,{timeout:15000});

  await spectator.locator('#room-role').selectOption('spectator');
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('In the lobby as spectator.'),null,{timeout:15000});
  await host.waitForFunction(()=>document.querySelector('#lobby')?.textContent?.includes('Spectators: 1'),null,{timeout:15000});
  await spectator.locator('#room-role').selectOption('player');
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('Connected as Player 3'),null,{timeout:15000});
  await spectator.locator('#room-role').selectOption('spectator');
  await spectator.waitForFunction(()=>document.querySelector('#network-status')?.textContent?.includes('In the lobby as spectator.'),null,{timeout:15000});

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
  if(await spectator.locator('#board-action-pane').isVisible()||await spectator.locator('#board-trade-pane').isVisible())throw new Error('Spectator was offered gameplay controls.');
  if(await spectator.locator('#room-ready').isVisible())throw new Error('Spectator ready control was visible.');
  if(await spectator.locator('#player-strip .player-summary').count()!==2)throw new Error('Spectator did not receive public player state.');

  const placeSetupPair=async(actor,observer,startRevision)=>{
    await actor.getByRole('button',{name:'Place settlement'}).click();
    if(await actor.locator('[data-legal-target="settlement"]').count()<1)throw new Error('No legal settlement targets were highlighted.');
    await actor.getByRole('button',{name:'Cancel selection'}).click();
    if(await actor.locator('[data-legal-target="settlement"]').count()!==0)throw new Error('Cancel selection left settlement targets active.');
    await actor.getByRole('button',{name:'Place settlement'}).click();
    await clickBoardTarget(actor);
    await observer.waitForFunction(rev=>document.querySelector('#game-status')?.textContent?.includes(`Revision ${rev}`),startRevision+1,{timeout:15000});
    await actor.getByRole('button',{name:'Place road',exact:true}).click();
    if(await actor.locator('[data-legal-target="road"]').count()<1)throw new Error('No legal road targets were highlighted.');
    await clickBoardTarget(actor);
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
  await clickBoardTarget(actor);
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
    if(await actor.locator('#player-strip .player-knight-count').count()!==2)throw new Error(`Played-knight counts missing at ${width}px.`);
    if(await actor.locator('#player-strip .player-vp-count').count()!==2)throw new Error(`Public victory points missing at ${width}px.`);
    if(await actor.locator('.board-stage #player-strip').count()!==1)throw new Error(`Player HUD is not attached to the board at ${width}px.`);
    for(const selector of ['.player-road-left','.player-settlement-left','.player-city-left','.player-longest-road'])if(await actor.locator(`#player-strip ${selector}`).count()!==2)throw new Error(`Public piece/road status ${selector} missing at ${width}px.`);
    if(await actor.locator('#piece-supply .supply-settlement').count()!==1||await actor.locator('#piece-supply .supply-city').count()!==1)throw new Error(`Local building supply missing at ${width}px.`);
    if(!(await actor.locator('#turn-banner').textContent())?.includes('Player 2'))throw new Error(`Board turn banner missing at ${width}px.`);
    if(await actor.locator('#board [data-port-type] .port-pier-leg').count()!==18)throw new Error(`Port dock legs missing at ${width}px.`);
    if(await actor.locator('#board [data-port-type]:not([data-port-type="generic"]) [data-resource-icon]').count()!==5)throw new Error(`Resource port icons missing at ${width}px.`);
    if(width<=760&&await actor.locator('#board .port-boat-decor').first().evaluate(node=>getComputedStyle(node).display)!=='none')throw new Error(`Port boat decoration was not simplified on mobile at ${width}px.`);
    if(await actor.locator('#board [data-hex-id] [data-resource-icon]').count()!==18)throw new Error(`Tile icons missing at ${width}px.`);
    if(await actor.locator('#board [data-terrain-icon="desert"]').count()!==1)throw new Error(`Desert icon missing at ${width}px.`);
    if(await actor.locator('#board [data-robber-marker="true"]').count()!==1)throw new Error(`Robber prohibition marker missing at ${width}px.`);
    const robberOpacity=await actor.locator('#board .robber-occupied .island-cell').evaluate(node=>getComputedStyle(node).opacity);
    if(Number(robberOpacity)>=0.7)throw new Error(`Robber tile was not visibly dimmed at ${width}px.`);
    if(await actor.locator('#board [data-hex-id][data-resource]:not([data-resource="none"]) text.island-label').count()!==0)throw new Error(`Resource tiles still show terrain labels at ${width}px.`);
    if(await actor.locator('#board ul[aria-label="Island terrain and number tokens"] li').count()!==19)throw new Error('Accessible tile descriptions are missing.');
    if(!await actor.getByRole('button',{name:'Place road',exact:true}).isEnabled())throw new Error('Expected an enabled setup road action.');
    if(await actor.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`Page overflow at ${width}px.`);
    const responsive=await actor.evaluate(()=>{
      const rect=selector=>document.querySelector(selector)?.getBoundingClientRect();
      const main=rect('main'),stage=rect('.board-stage'),players=rect('.board-player-column'),map=rect('.board-map-column'),board=rect('#board'),controls=rect('.board-command-column'),actions=rect('#board-action-pane'),trade=rect('#board-trade-pane');
      return {mainWidth:main?.width??0,stageWidth:stage?.width??0,
       playerLeft:players?.left??0,playerRight:players?.right??0,playerTop:players?.top??0,
       mapLeft:map?.left??0,mapRight:map?.right??0,mapTop:map?.top??0,mapBottom:map?.bottom??0,
       boardWidth:board?.width??0,controlLeft:controls?.left??0,controlTop:controls?.top??0,
       actionLeft:actions?.left??0,actionTop:actions?.top??0,actionBottom:actions?.bottom??0,
       tradeLeft:trade?.left??0,tradeTop:trade?.top??0,tradeRight:trade?.right??0};
    });
    if(width>=1200){
      if(responsive.mainWidth<1000)throw new Error(`Desktop workspace too narrow at ${width}px.`);
      if(responsive.playerRight>responsive.mapLeft+4)throw new Error(`Player column overlaps the board at ${width}px.`);
      if(responsive.boardWidth<480)throw new Error(`Central board too narrow at ${width}px.`);
      if(responsive.controlLeft<responsive.mapRight-4)throw new Error(`Actions do not sit right of the board at ${width}px.`);
      if(responsive.tradeTop<responsive.actionBottom-5)throw new Error(`Trade pane does not sit below actions at ${width}px.`);
    }else{
      if(responsive.mapTop<responsive.playerTop||responsive.controlTop<responsive.mapBottom-6)throw new Error(`Mobile board/control order incorrect at ${width}px.`);
      if(responsive.actionLeft>=responsive.tradeLeft||Math.abs(responsive.tradeTop-responsive.actionTop)>8)throw new Error(`Mobile Actions and Trade are not side-by-side at ${width}px.`);
      if(responsive.tradeRight>width+1)throw new Error(`Mobile trade panel overflows at ${width}px.`);
    }
    const before=await actor.evaluate(()=>globalThis.__hexVisualMessageCount);
    if(await actor.locator('[data-panel]').count()!==0)throw new Error('Obsolete tab navigation returned.');
    if(await actor.locator('#board-action-pane').count()!==1||await actor.locator('#board-trade-pane').count()!==1)throw new Error('The simultaneous action and trade panes were lost.');
    if(await actor.evaluate(()=>globalThis.__hexVisualMessageCount)!==before)throw new Error('Rendering the integrated board sent a network message.');
  }

  // A desktop browser is height-constrained: the full SVG, player tray and
  // action/trade viewport must fit in a single screen without clipping the map.
  for(const height of [720,900,1080]){
    await actor.setViewportSize({width:1280,height});
    await actor.waitForFunction(()=>{
      const stage=document.querySelector('.board-workspace .board-stage');
      if(!stage)return false;
      const rect=stage.getBoundingClientRect();
      return Math.abs(rect.bottom-(window.innerHeight-18))<8;
    },null,{timeout:6000});
    const fit=await actor.evaluate(()=>{
      const rect=selector=>document.querySelector(selector)?.getBoundingClientRect();
      const stage=rect('.board-workspace .board-stage'),board=rect('.board-map-column .island-board'),map=rect('.board-map-column'),players=rect('.board-player-column'),controls=rect('.board-command-column');
      const left=document.querySelector('.board-player-column'),right=document.querySelector('.board-command-column');
      return {viewportHeight:window.innerHeight,stageBottom:stage?.bottom??Infinity,
        boardTop:board?.top??0,boardBottom:board?.bottom??Infinity,boardHeight:board?.height??0,
        mapBottom:map?.bottom??Infinity,playersBottom:players?.bottom??Infinity,controlsBottom:controls?.bottom??Infinity,
        leftOverflow:getComputedStyle(left).overflowY,rightOverflow:getComputedStyle(right).overflowY};
    });
    if(fit.boardHeight<220||fit.boardBottom>height+2||fit.mapBottom>height+2)throw new Error(`Full desktop board did not fit ${height}px viewport: ${JSON.stringify(fit)}`);
    if(fit.playersBottom>height+2||fit.controlsBottom>height+2)throw new Error(`In-board side trays exceed ${height}px viewport.`);
    if(fit.leftOverflow!=='auto'||fit.rightOverflow!=='auto')throw new Error('Desktop side trays must scroll independently.');
    if(await actor.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error(`Desktop layout has horizontal overflow at 1280x${height}.`);
  }
  await actor.setViewportSize({width:1600,height:900});

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

  hostRecovered.once('dialog',dialog=>dialog.accept());
  await hostRecovered.locator('#game-restart').click();
  await hostRecovered.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'),null,{timeout:15000});
  await guestRecovered.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Revision 0'),null,{timeout:15000});
  if(await guestRecovered.locator('#player-strip .player-summary').count()!==2)throw new Error('Same-room restart did not preserve player seats.');
  // Host can abort to the same board workspace, change mode and seed, and start again.
  if(await guestRecovered.locator('#game-change-map').isVisible())throw new Error('Non-host can abort or reconfigure.');
  hostRecovered.once('dialog',dialog=>dialog.accept());
  await hostRecovered.locator('#game-change-map').click();
  await hostRecovered.waitForFunction(()=>document.body.classList.contains('room-configuring')&&document.querySelector('#room-map-lobby')?.getClientRects().length>0,null,{timeout:15000});
  await guestRecovered.waitForFunction(()=>document.body.classList.contains('room-configuring')&&document.querySelectorAll('#board [data-hex-id]').length===19,null,{timeout:15000});
  if(await guestRecovered.locator('#room-game-mode').isEnabled())throw new Error('Guest can change mode after an abort.');
  if(await hostRecovered.locator('#room-start').isEnabled())throw new Error('Abort failed to clear old readiness.');
  await hostRecovered.locator('#room-game-mode').selectOption('harbor-coop');
  await hostRecovered.locator('#room-seed').fill('67890');
  await hostRecovered.locator('#room-seed').dispatchEvent('change');
  await guestRecovered.waitForFunction(()=>document.querySelector('#room-game-mode')?.value==='harbor-coop'&&document.querySelector('#room-seed')?.value==='67890',null,{timeout:15000});
  await hostRecovered.locator('#room-ready').click();
  await guestRecovered.locator('#room-ready').click();
  await hostRecovered.waitForFunction(()=>!document.querySelector('#room-start')?.disabled,null,{timeout:15000});
  await hostRecovered.locator('#room-start').click();
  await hostRecovered.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Seed 67890')&&document.querySelector('#turn-banner')?.textContent?.includes('Harbor Co-op'),null,{timeout:15000});
  await guestRecovered.waitForFunction(()=>document.querySelector('#game-status')?.textContent?.includes('Seed 67890')&&document.querySelector('#turn-banner')?.textContent?.includes('Harbor Co-op'),null,{timeout:15000});
  console.log('E2E passed: immediate board, room setup, role switching, reconnect/recovery, restart, abort and reconfigure.');
} finally {
  await spectatorContext.close();
  await guestContext.close();
  await hostContext.close();
  await browser.close();
}
