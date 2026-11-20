import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('nickname field, target focus styling and development-card purchase placement stay in the intended UI surfaces',()=>{
  const html=readFileSync('index.html','utf8');
  const ui=readFileSync('src/game-ui.ts','utf8');
  const css=readFileSync('src/style.css','utf8');

  assert.ok(html.includes('id="room-nickname"'));
  assert.ok(html.includes('id="room-save-nickname"'));
  assert.ok(ui.includes("action(grid,'Buy development card'"));
  assert.ok(!ui.includes("action(cards,'Buy development card'"));
  assert.ok(css.includes('.game-target{')&&css.includes('outline:none'));
  assert.ok(css.includes('.game-target-city{')&&css.includes('outline:none'));
});


test('board buildings render semantic B3 SVG pieces directly in board coordinates',()=>{
  const ui=readFileSync('src/game-ui.ts','utf8');
  const css=readFileSync('src/style.css','utf8');
  assert.ok(ui.includes("data-building-kind"));
  assert.ok(ui.includes("data-vertex-id"));
  assert.ok(ui.includes("data-board-x"));
  assert.ok(ui.includes("game-building-piece game-building-"));
  assert.ok(ui.includes("M${x-.24} ${y+.19}V${y-.03}"));
  assert.ok(ui.includes("M${x-.33} ${y+.2}V${y-.07}"));
  assert.ok(!ui.includes("BOARD_BUILDING_PATHS[owner.kind]"));
  assert.ok(!ui.includes("scale(size/24)"));
  assert.ok(css.includes('.game-building-shell'));
  assert.ok(!ui.includes("owner.kind==='city'?'rect':'circle'"));
});


test('invite entry width restriction ends when gameplay begins and responsive game breakpoints are present',()=>{
  const css=readFileSync('src/style.css','utf8');
  assert.ok(css.includes('.invite-entry body:not(.playing) main{max-width:760px}'));
  assert.ok(!css.includes('.invite-entry main{max-width:760px}'));
  assert.ok(css.includes('@media(max-width:1100px)'));
  assert.ok(css.includes('.game-layout:not([hidden]){display:grid;grid-template-columns:minmax(0,1fr)'));
  assert.ok(css.includes('.island-board{width:100%;min-width:0;max-width:none}'));
});


test('turn changes flash the central cue and active player card exactly three times',()=>{
  const ui=readFileSync('src/game-ui.ts','utf8');
  const css=readFileSync('src/style.css','utf8');
  assert.ok(ui.includes("function flashTurnCue"));
  assert.ok(ui.includes("if(!boardFitReady)scheduleDesktopBoardFit();flashTurnCue(s);"));
  assert.ok(css.includes('.turn-banner.turn-cue-flash'));
  assert.ok(css.includes('.player-summary.active-player.turn-cue-flash'));
  assert.ok(css.includes('animation:turn-cue-pulse .55s ease-in-out 3'));
});


test('room creation exposes standard and 5-6 player board versions and six-player UI capacity',()=>{
 const html=readFileSync('index.html','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 const browser=readFileSync('src/game/network/browser.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(html.includes('id="room-board-version"'));
 assert.ok(html.includes('value="expanded-5-6"'));
 assert.ok(html.includes('<option value="5">5</option>'));
 assert.ok(html.includes('<option value="6">6</option>'));
 assert.ok(ui.includes("generateBoardSetup(input.valueAsNumber,boardVersion==='expanded-5-6'?'expanded-5-6':'standard')"));
 assert.ok(browser.includes("boardLayout==='expanded-5-6'?seats.length>=5&&seats.length<=6"));
 assert.ok(css.includes('.player-strip[data-player-count="6"]'));
});


test('turn handoff shows a large board-centered alert in addition to the three-pulse cue',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes("alert.className=`turn-alert player-${active.seat+1}`"));
 assert.ok(ui.includes("alert.setAttribute('role','alert')"));
 assert.ok(ui.includes("lead.textContent=active.id===viewer?'YOUR TURN':'NEXT TURN'"));
 assert.ok(css.includes('.turn-alert{'));
 assert.ok(css.includes('left:50%'));
 assert.ok(css.includes('top:50%'));
 assert.ok(css.includes('.turn-alert-name{'));
});

test('bank and port trading uses direct resource-icon buttons with live port rates',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes('function bankTradeButtons'));
 assert.ok(ui.includes('const rate=bankTradeRate(s,viewer,give)'));
 assert.ok(ui.includes("rateBadge.textContent=String(rate)"));
 assert.ok(ui.includes("arrow.textContent='→'"));
 assert.ok(ui.includes('tradeButton.append(from,arrow,to)'));
 assert.ok(ui.includes('if(receive===give||actor.hand[give]<rate||s.bank[receive]<1)continue;'));
 assert.ok(!ui.includes("rateBadge.textContent=`×${rate}`"));
 assert.ok(!ui.includes("icon(ACTION_PATHS.trade,'icon bank-trade-arrow')"));
 assert.ok(!ui.includes("select(trade,'Bank trade: give'"));
 assert.ok(!ui.includes("select(trade,'Receive'"));
 assert.ok(css.includes('.bank-trade-grid{'));
 assert.ok(css.includes('.bank-trade-button{'));
});

test('monopoly and invention resource choices use icon buttons instead of resource dropdowns',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes('function resourceChoice'));
 assert.ok(ui.includes('choice.append(resourceIcon(resource))'));
 assert.ok(ui.includes("resourceChoice(box,'Choose Monopoly resource')"));
 assert.ok(ui.includes("resourceChoice(box,'First resource')"));
 assert.ok(ui.includes("resourceChoice(box,'Second resource')"));
 assert.ok(!ui.includes("select(box,'Monopoly resource'"));
 assert.ok(!ui.includes("select(box,'First resource'"));
 assert.ok(!ui.includes("select(box,'Second resource'"));
 assert.ok(css.includes('.resource-choice-button[aria-pressed="true"]'));
});


test('public gameplay actions surface as centered board alerts without replacing turn alerts',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes('function centralActivity'));
 assert.ok(ui.includes('function showActivityAlert'));
 assert.ok(!ui.includes("kind==='dice'?'DICE ROLL'"),'no dice popup');
 assert.ok(ui.includes("kind==='development'?'CARD PLAY'"));
 assert.ok(ui.includes("kind==='build'?'BUILD'"));
 assert.ok(ui.includes("kind==='robber'?'ROBBER'"));
 assert.ok(ui.includes("kind==='trade'?'TRADE'"));
 assert.ok(ui.includes('if(!boardFitReady)scheduleDesktopBoardFit();flashTurnCue(s);'));
  assert.ok(ui.includes("el('board').querySelector('.turn-alert')?.remove()"));
  assert.ok(ui.includes('showActivityAlert(s);showVictoryAlert(s);scheduleLocalBot();'));
 assert.ok(!ui.includes('rolled dice|built a road|built a settlement'));
 assert.ok(css.includes('.activity-alert{'));
 assert.ok(css.includes('.activity-alert-message{'));
});


test('local test bot selector supports one through five bots and expands the board at five total players',()=>{
 const html=readFileSync('index.html','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 const targets=readFileSync('src/game/ui/targets.ts','utf8');
 const legal=readFileSync('src/game/rules/legal.ts','utf8');
 assert.ok(html.includes('id="local-bot-count"'));
 for(const label of ['1 bot · 2 players','2 bots · 3 players','3 bots · 4 players','4 bots · 5 players · expanded board','5 bots · 6 players · expanded board'])assert.ok(html.includes(label));
 const local=readFileSync('src/game/ui/local-room.ts','utf8');
 assert.ok(local.includes('export function createLocalRoomSettings'));
 assert.ok(local.includes("botCount===1?'Bot'"));
 assert.ok(local.includes("botCount>0?['Player 1',...Array.from"));
 assert.ok(local.includes("totalPlayers>=5?'expanded-5-6':'standard'"));
 assert.ok(ui.includes("localBotIds=new Set(settings.botCount?settings.ids.slice(1):[])"));
 assert.ok(ui.includes('state=createGame(settings.seed,settings.ids,undefined,{boardLayout:settings.boardLayout,mode:settings.mode,rules:settings.rules})'));
 assert.ok(html.includes('id="local-room-create"'));
 assert.ok(html.includes('id="local-room-lobby"'));
 assert.ok(html.includes('id="local-map-preview"'));
 assert.ok(html.includes('id="local-restart"'));
 assert.ok(ui.includes('function refreshLocalMapPreview()'));
 assert.ok(ui.includes('startLocalRound(activeLocalRoom)'));
 assert.ok(ui.includes("localSeats.value=String(count+1);localSeats.disabled=true"));
 assert.ok(ui.includes("count>=4?'Expanded 5–6 player board selected automatically.'"));
 assert.ok(ui.includes("if(old.currentSeat!==next.currentSeat&&localBotIds.size===0&&next.phase!=='finished')handoff"));
 assert.ok(ui.includes('pendingLocalBot'));
 assert.ok(ui.includes('scheduleLocalBot()'));
 assert.ok(targets.includes("from '../rules/legal.ts'"));
 assert.ok(legal.includes('createIslandBoard(state.board.layout)'));
});


test('player cards show played knight counts and highlight the largest army holder',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes("playerStat(DEVELOPMENT_PATHS.knight,player.knights,'Knights played','player-knight-count','K')"));
 assert.ok(ui.includes("if(s.armyHolder===player.id)publicStats.lastElementChild?.classList.add('largest-army-holder')"));
 assert.ok(ui.includes("knights played"));
 assert.ok(ui.includes("(Largest Army)"));
 assert.ok(css.includes('.player-knight-count.largest-army-holder'));
});


test('public player cards are slightly larger for readability on desktop and mobile',()=>{
 const css=readFileSync('src/style.css','utf8');
 assert.ok(css.includes('width:min(12.5rem,27%)'));
 assert.ok(css.includes('padding:.48rem .55rem'));
 assert.ok(css.includes('font-size:.78rem'));
 assert.ok(css.includes('.board-stage .player-summary-name{font-size:.82rem'));
 assert.ok(css.includes('position:static;width:auto;padding:.4rem .45rem'));
});


test('playable development cards are exposed directly in Actions with no Cards tab',()=>{
 const html=readFileSync('index.html','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(!html.includes('data-panel="cards"'));
 assert.ok(!html.includes('id="card-actions"'));
 assert.ok(!ui.includes("activePanel:'actions'|'cards'"));
 assert.ok(!ui.includes("el('card-actions')"));
 assert.ok(ui.includes("heading.textContent='Development cards'"));
 assert.ok(ui.includes("developmentAction(cardGrid,'Play Knight'"));
 assert.ok(css.includes('.development-actions-inline{'));
});


test('a winner gets a one-shot animated board-centered victory celebration',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes('function showVictoryAlert'));
 assert.ok(ui.includes("if(!s.winner||lastWinnerAlert===s.winner||el('game').hidden)return"));
 assert.ok(ui.includes('victory-alert player-${winner.seat+1}'));
 assert.ok(ui.includes("lead.textContent='VICTORY'"));
 assert.ok(ui.includes('WINS!'));
 assert.ok(ui.includes("alert.classList.add('victory-alert-out')"));
 assert.ok(ui.includes('},5000)'));
 assert.ok(ui.includes('if(!boardFitReady)scheduleDesktopBoardFit();flashTurnCue(s);'));
  assert.ok(ui.includes('showActivityAlert(s);showVictoryAlert(s);scheduleLocalBot();'));
 assert.ok(css.includes('.victory-alert{'));
 assert.ok(css.includes('@keyframes victory-confetti-pop'));
 assert.ok(css.includes('.victory-alert.victory-alert-out'));
});


test('ART-A01 board uses layered terrain, ocean, tabletop pieces and reduced-motion fallbacks',()=>{
 const render=readFileSync('src/game/board/render.ts','utf8');
 const game=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(render.includes("${prefix}-board-ocean-gradient"));
 assert.ok(render.includes("class:'board-ocean'"));
 assert.ok(render.includes("'data-terrain-art':terrain"));
 assert.ok(render.includes("class:'island-cell-shadow'"));
 assert.ok(render.includes("class:'island-cell-inset'"));
 assert.ok(render.includes("class:`island-token-rim"));
 assert.ok(render.includes("class:`island-token-pip"));
 assert.ok(render.includes("class:'robber-marker-ring'"));
 assert.ok(game.includes("game-road-shadow"));
 assert.ok(game.includes("game-road-highlight"));
 assert.ok(game.includes("game-building-shadow"));
 assert.ok(game.includes("PLAYER_PIECE_PALETTE"));
 assert.ok(game.includes("shell.setAttribute('fill',palette.body)"));
 assert.ok(render.includes('terrainFallback'));
 assert.ok(render.includes('boardRenderSequence'));
 assert.ok(render.includes('url(#${defsPrefix}-terrain-${hex.terrain})'));
 assert.ok(game.includes("data-board-x"));
 assert.ok(game.includes("M${x-.24} ${y+.19}V${y-.03}"));
 assert.ok(!game.includes("scale(size/24)"));
 assert.ok(game.includes("robber-marker-enter"));
 assert.ok(css.includes('/* ART-A01 · modern illustrated tabletop board */'));
 assert.ok(css.includes('.game-road-piece.player-5'));
 assert.ok(css.includes('.game-road-piece.player-6'));
 assert.ok(css.includes('@keyframes road-grow'));
 assert.ok(css.includes('@keyframes building-place'));
 assert.ok(css.includes('@keyframes robber-settle'));
 assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
});


test('ART-B01 keeps player, hand and trade art in the integrated board',()=>{
 const icons=readFileSync('src/game/ui/icons.ts','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(icons.includes('resource-chip-${resource}'));
 assert.ok(icons.includes("chip.setAttribute('data-resource',resource)"));
 assert.ok(ui.includes('function playerAward'));
 assert.ok(ui.includes("'Longest Road'"));
 assert.ok(ui.includes("'Largest Army'"));
 assert.ok(ui.includes('player-awards'));
 assert.ok(ui.includes('action-${symbol}'));
 assert.ok(ui.includes('bank-trade-rate-${rate}'));
 assert.ok(ui.includes("domestic.className='domestic-trade-card'"));
 assert.ok(!ui.includes("tab.dataset.panel==='actions'"));
 assert.ok(!ui.includes("tab.dataset.panel==='status'"));
 assert.ok(ui.includes("incomingTradeCard(trade,s.offer)"));
 assert.ok(css.includes('/* ART-B01 · tabletop control-surface visual system */'));
 assert.ok(css.includes('.hand-card.active-hand'));
 assert.ok(css.includes('.action-button.action-settlement'));
 assert.ok(css.includes('.action-button.action-card'));
 assert.ok(css.includes('.bank-trade-button.bank-trade-rate-2'));
 assert.ok(css.includes('.domestic-trade-card'));
 assert.ok(css.includes('.player-award'));
 assert.ok(css.includes('@media(max-width:760px)'));
});


test('ART-C01 keeps card animation but renders dice on the board',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes("type ActivityMotionKind='development'|'card-buy'|'build'|'robber'|'trade'|'generic'"));
 assert.ok(ui.includes('pendingRollPresentation=describeRoll('));
 assert.ok(readFileSync('src/game/board/three/roll-scene.ts','utf8').includes('RoundedBoxGeometry'));
 assert.ok(ui.includes('function playedDevelopment'));
 assert.ok(ui.includes('function motionCard'));
 assert.ok(ui.includes('activity-alert activity-${kind}'));
 assert.ok(ui.includes('boardRenderer?.playRoll(pendingRollPresentation)'));
 assert.ok(ui.includes("kind==='development'"));
 assert.ok(ui.includes("kind==='card-buy'"));
 assert.ok(css.includes('/* ART-C01 · motion polish */'));
 assert.ok(css.includes('@keyframes dice-tumble'));
 assert.ok(css.includes('@keyframes card-flip-in'));
 assert.ok(css.includes('@keyframes turn-name-settle'));
 assert.ok(css.includes('@keyframes panel-reveal'));
 assert.ok(css.includes('.motion-die'));
 assert.ok(css.includes('.motion-card-face'));
 assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
});


test('ART-FINAL renders ports as coastal docks and removes the old floating circular badge',()=>{
 const render=readFileSync('src/game/board/render.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(render.includes("dockDistance=.78,dockBias=.055"));
 assert.ok(render.includes("line(group,a.x,a.y,aDock.x,aDock.y,'port-pier-leg port-pier-a')"));
 assert.ok(render.includes("line(group,b.x,b.y,bDock.x,bDock.y,'port-pier-leg port-pier-b')"));
 assert.ok(!render.includes("'port-pier-stem'"));
 assert.ok(render.includes("class:'port-dock-board'"));
 assert.ok(render.includes("width:'1.12',height:'.72'"));
 assert.ok(render.includes("line(dock,x,-.31,x,.31,'port-dock-plank')"));
 assert.ok(render.includes("class:'port-bollard'"));
 assert.ok(!render.includes("'port-anchor-icon'"));
 assert.ok(render.includes("label.classList.add('port-label-generic')"));
 assert.ok(render.includes("symbol.setAttribute('width','.40')"));
 assert.ok(css.includes('font-size:.27px'));
 assert.ok(css.includes('.port-label-generic{font-size:.31px'));
 assert.ok(css.includes('.activity-production-summary{'));
 assert.ok(render.includes("class:'port-boat-decor'"));
 assert.ok(!render.includes("class:'port-badge'"));
 assert.ok(!render.includes("class:'port-badge-shadow'"));
 assert.ok(css.includes('/* ART-FINAL · coastal ports and board consistency pass */'));
 assert.ok(css.includes('.port-dock-board'));
 assert.ok(!render.includes("class:'port-anchor-icon'"));
 assert.ok(css.includes('.port-boat-decor'));
 assert.ok(css.includes('.port-dock-plank,.port-bollard,.port-boat-decor{display:none}'));
});


test('all six player UI colors match the authoritative board-piece palette',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 const colors=['#2868b2','#c74a42','#f27ebd','#8b55a1','#d48826','#2b9295'];
 assert.equal(new Set(colors).size,6,'all six players need unique color assignments');
 const rgb=(hex:string)=>[1,3,5].map(index=>Number.parseInt(hex.slice(index,index+2),16));
 const rose=rgb(colors[2]);
 for(const [index,color] of colors.entries()){
  if(index===2)continue;
  const distance=Math.hypot(...rose.map((channel,i)=>channel-rgb(color)[i]));
  assert.ok(distance>100,`Seat 3 pink must be visually separate from seat ${index+1} (distance ${distance})`);
 }
 assert.equal(colors[5],'#2b9295','seat 6 retains its own teal hue');
 for(const [index,color] of colors.entries()){
  const seat=index+1;
  assert.ok(css.includes(`.player-summary.player-${seat}{--player-color:${color}}`));
  assert.ok(css.includes(`.game-road-piece.player-${seat}{--road-color:${color}`));
  assert.ok(css.includes(`.game-building-piece.player-${seat}{--piece-color:${color}`));
  assert.ok(css.includes(`.turn-alert.player-${seat}{--turn-alert-color:${color}}`));
  assert.ok(css.includes(`.activity-alert.player-${seat}{--turn-alert-color:${color}}`));
  assert.ok(css.includes(`.victory-alert.player-${seat}{--victory-color:${color}}`));
 }
 assert.ok(ui.includes("const PLAYER_PIECE_PALETTE=[{body:'#2868b2'"));
 assert.ok(ui.includes("{body:'#d48826',edge:'#9a5d12'}"));
 assert.ok(ui.includes("{body:'#f27ebd',edge:'#993a70'}"));
  assert.ok(css.includes('.game-road-piece.player-3{--road-color:#f27ebd;--road-edge:#993a70}'));
  assert.ok(css.includes('.game-building-piece.player-3{--piece-color:#f27ebd;--piece-edge:#993a70;color:#993a70}'));
  assert.ok(ui.includes("{body:'#2b9295',edge:'#176b70'}"));
});


test('brick and ore terrain backgrounds read as clay quarry and exposed rock sources',()=>{
 const render=readFileSync('src/game/board/render.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(render.includes("class:'terrain-art-brick'"));
 assert.ok(render.includes("'terrain-art-clay-face'"));
 assert.ok(render.includes("'terrain-art-quarry-cut'"));
 assert.ok(render.includes("class:'terrain-art-rubble'"));
 assert.ok(render.includes("'terrain-art-rock-fill'"));
 assert.ok(render.includes("'terrain-art-quarry-bench'"));
 assert.ok(css.includes('.terrain-art-hills .terrain-art-clay-face'));
 assert.ok(css.includes('.terrain-art-hills .terrain-art-brick'));
 assert.ok(css.includes('.terrain-art-mountains .terrain-art-rock-fill'));
 assert.ok(css.includes('.terrain-art-mountains .terrain-art-rubble'));
 assert.ok(render.includes("L${cx-.18} ${cy-.03}"));
 assert.ok(render.includes("L${cx+.08} ${cy-.12}"));
 assert.ok(!render.includes("L${cx+.08} ${cy-.48}"));
});

test('board-integrated dice, production pulses and player-colored building gains',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 const roll=readFileSync('src/game/board/three/roll-presentation.ts','utf8');
  const scene=readFileSync('src/game/board/three/roll-scene.ts','utf8');
  const fallback=readFileSync('src/game/board/three/roll-overlay.ts','utf8');
  const css3d=readFileSync('src/three-board.css','utf8');
  assert.ok(roll.includes('calculateDiceProduction(before, total)'));
  assert.ok(scene.includes("sprite.name='building-resource-gain'"));
  assert.ok(scene.includes('this.playerColor(gains[0].playerId)'));
  assert.ok(fallback.includes('tag.dataset.rollBuilding=vertexId'));
  assert.ok(css3d.includes('.board-roll-gain'));
  assert.ok(!ui.includes('alert.append(productionSummary('));
  assert.ok(css.includes('.activity-production-chip'));
});

test('safe Undo action is appended last in Actions for active and non-active players',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.ok(ui.includes('const appendUndoAction=()=>'));
 assert.ok(ui.includes("undoRow.className='action-grid undo-action-row';actions.append(undoRow)"));
 assert.ok(ui.includes('if(viewer!==active.id){appendUndoAction();finishControls();return;}'));
 const start=ui.indexOf("if(!isHarbor(s)&&!['setup-settlement','setup-road','finished'].includes(s.phase)");
 const end=ui.indexOf('finishControls();',start);
 assert.ok(start>=0&&end>start);
 assert.ok(ui.slice(start,end).includes('appendUndoAction();'));
 assert.ok(css.includes('.undo-action-row .action-button{grid-column:1/-1'));
});

test('multi-discard stage uses a private acknowledgement and keeps other players on the original revision',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 const session=readFileSync('src/game/network/session.ts','utf8');
 const authority=readFileSync('src/game/network/authority.ts','utf8');
 assert.ok(ui.includes('discardPending:()=>{'));
 assert.ok(ui.includes("note.className='discard-submitted'"));
 assert.ok(ui.includes("discardSubmitted?'Your discard is submitted."));
 assert.ok(session.includes("this.output(peer,'discard-pending'"));
 assert.ok(session.includes("this.emitCheckpoint(true);"));
 assert.ok(authority.includes('if(Object.keys(this.pendingDiscards).length<Object.keys(this.state.discards).length)'));
});

test('board workspace contains player, map, and simultaneous actions/trades without a separate panel',()=>{
 const html=readFileSync('index.html','utf8'),ui=readFileSync('src/game-ui.ts','utf8'),css=readFileSync('src/style.css','utf8');
 assert.ok(html.includes('class="game-layout board-workspace"'));
 assert.ok(html.includes('class="board-player-column"'));
 assert.ok(html.includes('class="board-map-column"'));
 assert.ok(html.includes('class="board-command-column"'));
 assert.ok(html.includes('id="board-action-pane"'));
 assert.ok(html.includes('id="board-trade-pane"'));
 assert.ok(!html.includes('id="game-tabs"'));
 assert.ok(!html.includes('class="control-panel"'));
 assert.ok(!ui.includes('function setPanel('));
 assert.ok(!ui.includes("document.querySelectorAll<HTMLButtonElement>('[data-panel]')"));
 assert.ok(ui.includes("incomingTradeCard(trade,s.offer)"));
 assert.ok(ui.includes('finishControls();'));
 assert.ok(css.includes('grid-template-areas:"status status" "actions trade"'));
 assert.ok(css.includes('grid-template-columns:minmax(195px,255px) minmax(0,1fr) minmax(260px,335px)'));
});

test('desktop map fits the viewport height while only side columns can scroll',()=>{
 const css=readFileSync('src/style.css','utf8'),ui=readFileSync('src/game-ui.ts','utf8'),qa=readFileSync('scripts/qa-e2e.mjs','utf8');
 assert.ok(css.includes('@media(min-width:1101px)'));
 assert.ok(css.includes('height:var(--board-fit-height,calc(100dvh - 12rem))'));
 assert.ok(css.includes('.board-workspace .board-map-column .island-board{'));
 assert.ok(css.includes('height:100%;'));
 assert.ok(css.includes('overflow-y:auto;'));
 assert.ok(ui.includes('function fitBoardToDesktopViewport()'));
 assert.ok(ui.includes('stableBoardFitHeight(window.innerHeight,top)'));
 assert.ok(ui.includes('if(!boardFitReady)scheduleDesktopBoardFit();'));
 assert.ok(qa.includes('for(const height of [720,900,1080])'));
});

test('ship action is visible with materials even when there is no legal harbor target',()=>{
  const ui=readFileSync('src/game-ui.ts','utf8');
  const status=readFileSync('src/game/ui/ship-action.ts','utf8');
  const css=readFileSync('src/compact-actions.css','utf8');
  assert.ok(ui.includes("if(!isHarbor(s)&&(s.rules?.ships||affordable(actor.hand,SHIP_COST)))"));
  assert.ok(ui.includes('const ship=shipActionAvailability(s,viewer)'));
  assert.ok(ui.includes("shipButton.dataset.shipAvailability=ship.enabled?'ready':'blocked'"));
  assert.ok(ui.includes("shipButton.disabled=true"));
  assert.ok(ui.includes("hint.className='ship-action-reason'"));
  assert.ok(status.includes("legalTargetIds(state,playerId,'ship')"));
  assert.ok(css.includes('> .ship-action-reason'));
});
