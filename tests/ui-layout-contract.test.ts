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
