import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TargetFeedback, TARGET_COLORS } from '../src/game/board/target-feedback.ts';

test('one hovered target is orange and the prior selection returns on leave', () => {
  const view = new TargetFeedback(); view.update('board:road', ['a','b']);
  view.select('a'); assert.equal(view.active,'a');
  view.hover('b'); assert.equal(view.active,'b'); assert.equal(view.selected,'a');
  view.hover(null); assert.equal(view.active,'a');
  assert.equal(TARGET_COLORS.legal,'#fff3a0'); assert.equal(TARGET_COLORS.active,'#ff981f');
});
test('selection, cancellation, new board and mode changes clear obsolete highlights', () => {
  const view = new TargetFeedback(); view.update('board:road',['a','b']);
  view.hover('b'); view.select('a'); assert.equal(view.active,'a');
  view.update('board:road',['a','c']); assert.equal(view.active,'a');
  view.update('board:road',['c']); assert.equal(view.active,null);
  view.select('invalid'); view.hover('invalid'); assert.equal(view.active,null);
  view.select('c'); view.update('board:city',['c']); assert.equal(view.active,null);
  view.select('c'); view.update('another:city',['c']); assert.equal(view.active,null);
  view.select('c'); view.update('another:',[]); assert.equal(view.active,null);
});
test('preview is local and independent for each player', () => {
  const a = new TargetFeedback(), b = new TargetFeedback();
  for (const v of [a,b]) v.update('road',['r1','r2']);
  a.hover('r1'); b.select('r2'); assert.equal(a.active,'r1'); assert.equal(b.active,'r2');
});
test('pointer highlighting has dedicated material, cleanup and no game/UI rebuild', () => {
  const source=readFileSync('src/game/board/three/renderer.ts','utf8');
  assert.ok(source.includes('private activeTargetMaterial'));
  assert.ok(source.includes('object.material = material'));
  assert.ok(source.includes('this.activeTargetMaterial.dispose()'));
  const hover=source.slice(source.indexOf('private hover ='),source.indexOf('private corners()'));
  assert.ok(!hover.includes('this.choose(')); assert.ok(!hover.includes('this.resetView('));
  assert.ok(source.includes("this.canvas.addEventListener('pointercancel', this.leaveTarget"));
});
test('3D and SVG keep on-board feedback without coordinate selection controls', () => {
  const ui=readFileSync('src/game-ui.ts','utf8');
  assert.ok(!ui.includes("select(targets,'Legal target'"));
  assert.ok(!ui.includes("button(targets,'Use target'"));
  assert.ok(ui.includes("button(targets,'Cancel selection'"));
  assert.ok(ui.includes('Click or tap a highlighted'));
  assert.equal((ui.match(/setAttribute\('data-target-id'/g)||[]).length,4);
  const css=readFileSync('src/target-feedback.css','utf8');
  for(const part of ['game-target-vertex','game-target-road','game-target-city','robber-target'])assert.ok(css.includes(part+'.target-active'));
});

test('entering target mode does not preselect a hidden coordinate',()=>{
 const preview=new TargetFeedback();preview.update('board:road',['a','b']);
 assert.equal(preview.active,null);preview.hover('b');assert.equal(preview.active,'b');
 preview.hover(null);assert.equal(preview.active,null);
});
