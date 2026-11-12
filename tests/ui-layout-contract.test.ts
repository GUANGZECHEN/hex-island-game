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
  assert.ok(ui.includes("drawBoard();flashTurnCue(s);"));
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
 assert.ok(ui.includes('tradeButton.disabled=actor.hand[give]<rate||s.bank[receive]<1'));
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
 assert.ok(ui.includes("lead.textContent='TABLE ACTION'"));
 assert.ok(ui.includes('drawBoard();flashTurnCue(s);showActivityAlert(s);'));
 assert.ok(ui.includes('rolled dice|built a road|built a settlement'));
 assert.ok(css.includes('.activity-alert{'));
 assert.ok(css.includes('.activity-alert-message{'));
});


test('local test bot selector supports one-bot/two-player and two-bot/three-player offline modes',()=>{
 const html=readFileSync('index.html','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 const targets=readFileSync('src/game/ui/targets.ts','utf8');
 const legal=readFileSync('src/game/rules/legal.ts','utf8');
 assert.ok(html.includes('id="local-bot-count"'));
 assert.ok(html.includes('1 bot · 2 players'));
 assert.ok(html.includes('2 bots · 3 players'));
 assert.ok(ui.includes("localBotIds=new Set(botCount===1?['Bot']:botCount===2?['Bot 1','Bot 2']:[])"));
 assert.ok(ui.includes("botCount===2?['Player 1','Bot 1','Bot 2']"));
 assert.ok(ui.includes("localSeats.value=String(count+1);localSeats.disabled=true"));
 assert.ok(ui.includes("if(old.currentSeat!==next.currentSeat&&localBotIds.size===0)handoff"));
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
 assert.ok(ui.includes('drawBoard();flashTurnCue(s);showActivityAlert(s);showVictoryAlert(s);scheduleLocalBot();'));
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
