import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compactBoardSize} from '../src/game/ui/compact-layout.ts';

test('height-limited boards keep side columns adjacent instead of stretching the middle track', () => {
  const size=compactBoardSize(1800,480,10,10)!;
  assert.equal(size.mapWidth,480);
  assert.equal(size.stageWidth,1006);
  assert.equal(size.gap,8);
  assert.ok(size.stageWidth<1800);
});

test('standard and expanded maps respect both available dimensions across desktop sizes', () => {
  for(const width of [1028,1200,1600,2400])for(const height of [360,480,640,880])for(const ratio of [1,1.17]){
    const size=compactBoardSize(width,height,ratio,1)!;
    assert.ok(size.stageWidth<=width);
    assert.ok(size.mapWidth/ratio<=height);
    assert.equal(size.stageWidth-size.mapWidth,size.playerWidth+size.controlWidth+size.gap*2);
    assert.ok(size.mapWidth>0);
  }
});

test('unmeasurable and hidden surfaces do not emit invalid CSS dimensions', () => {
  for(const value of [0,-1,NaN,Infinity]){
    assert.equal(compactBoardSize(value,500,10,10),null);
    assert.equal(compactBoardSize(1200,value,10,10),null);
    assert.equal(compactBoardSize(1200,500,value,10),null);
    assert.equal(compactBoardSize(1200,500,10,value),null);
  }
  assert.equal(compactBoardSize(500,500,10,10),null);
});

test('one existing private hand is directly before Actions inside the command column', () => {
  const html=readFileSync('index.html','utf8');
  const commands=html.indexOf('class="board-command-column"');
  const hand=html.indexOf('id="private-hand-card"');
  const actions=html.indexOf('id="board-action-pane"');
  assert.ok(commands>=0&&hand>commands&&actions>hand);
  assert.equal(html.match(/id="private-hand-card"/g)?.length,1);
  assert.ok(html.includes('/src/game/ui/compact-layout.ts'));
  const css=readFileSync('src/compact-layout.css','utf8');
  assert.ok(css.includes('"status status" "hand hand" "actions trade"'));
  assert.ok(css.includes('max-width: var(--compact-stage-width,100%)'));
});
