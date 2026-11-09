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


test('board buildings render semantic B3 SVG pieces instead of circle/rect ownership markers',()=>{
  const ui=readFileSync('src/game-ui.ts','utf8');
  const css=readFileSync('src/style.css','utf8');
  assert.ok(ui.includes("data-building-kind"));
  assert.ok(ui.includes("BOARD_BUILDING_PATHS[owner.kind]"));
  assert.ok(ui.includes("game-building-piece game-building-"));
  assert.ok(css.includes('.game-building-shell'));
  assert.ok(css.includes('.game-building-city'));
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
