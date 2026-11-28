import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stableBoardFitHeight } from '../src/game/ui/board-fit.ts';

test('board fit uses document position, not scroll-dependent viewport top',()=>{
 const docTop=173;
 const height=stableBoardFitHeight(900,docTop);
 assert.equal(height,709);
 for(const scrollY of [0,15,78,120,355,900]){
  const clientTop=docTop-scrollY;
  assert.equal(stableBoardFitHeight(900,clientTop+scrollY),height);
 }
});
test('board height follows true screen resize without becoming negative',()=>{
 assert.ok(stableBoardFitHeight(1080,120)>stableBoardFitHeight(720,120));
 assert.equal(stableBoardFitHeight(300,230),180);
 assert.throws(()=>stableBoardFitHeight(0,100),/viewport/);
});
test('game updates do not schedule a viewport fit on every trade or turn',()=>{
 const ui=readFileSync('src/game-ui.ts','utf8');
 assert.ok(ui.includes("if(!boardFitReady)scheduleDesktopBoardFit();"));
 assert.ok(ui.includes("stage.getBoundingClientRect().top+window.scrollY"));
 assert.ok(ui.includes("function onViewportSizeChange(){boardFitReady=false;scheduleDesktopBoardFit();}"));
 assert.ok(!ui.includes('drawBoard();scheduleDesktopBoardFit();flashTurnCue(s)'));
});
