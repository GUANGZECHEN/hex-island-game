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
  assert.ok(ui.includes("renderPlayerStrip(s,active.id);flashTurnCue(s);"));
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
