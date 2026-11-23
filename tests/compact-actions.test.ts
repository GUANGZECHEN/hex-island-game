import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactActionLabel, setCompactActionLabel } from '../src/game/ui/compact-actions.ts';

test('construction and development labels use short consistent words', () => {
  for (const [full, short] of Object.entries({
    'Place road':'Road', 'Build road':'Road', 'Place settlement':'Settlement',
    'Build settlement':'Settlement', 'Upgrade house to city':'City', 'Buy development card':'Develop',
  })) assert.equal(compactActionLabel(full), short);
});
test('other common action labels are short; Undo and unknown labels keep their explicit wording', () => {
  assert.equal(compactActionLabel('Roll dice'), 'Roll');
  assert.equal(compactActionLabel('Move robber'), 'Robber');
  assert.equal(compactActionLabel('Play Knight'), 'Knight');
  assert.equal(compactActionLabel('Play Monopoly'), 'Monopoly');
  assert.equal(compactActionLabel('Undo last action'), 'Undo last action');
  assert.equal(compactActionLabel('End turn'), 'End turn');
  assert.equal(compactActionLabel('Future action'), 'Future action');
  assert.equal(compactActionLabel('Build ship · 2/2 left · 1 VP'),'Ship · 2/2 (+1 VP)');
  assert.equal(compactActionLabel('Build ship · 0/2 left · 1 VP'),'Ship · 0/2 (+1 VP)');
  assert.equal(compactActionLabel('toString'), 'toString');
});
test('visual labels retain full hover and accessible names without replacing the button', () => {
  const attributes = new Map<string,string>(); const click = () => {};
  const button = { title: '', onclick: click, setAttribute: (key:string, value:string) => attributes.set(key,value) };
  const text = { textContent: '' };
  setCompactActionLabel(button as unknown as HTMLButtonElement, text as HTMLElement, 'Build settlement');
  assert.equal(text.textContent, 'Settlement');
  assert.equal(button.title, 'Build settlement');
  assert.equal(attributes.get('aria-label'), 'Build settlement');
  assert.equal(button.onclick, click);
});
test('both action factories use compact labels and cost rows have dedicated grid space', () => {
  const ui=readFileSync('src/game-ui.ts','utf8'), css=readFileSync('src/compact-actions.css','utf8');
  assert.equal(ui.split('setCompactActionLabel(b,text,label)').length-1, 2);
  assert.ok(ui.includes("import './compact-actions.css'"));
  assert.ok(css.includes('grid-column: 1 / -1'));
  assert.ok(css.includes('grid-row: 2'));
  assert.ok(css.includes('grid-template-columns: 1.12rem minmax(0, 1fr)'));
  assert.ok(ui.includes("learningAction('Build settlement','settlement',()=>mode('settlement'),base.settlement,settlementIsFree?0:{lumber:1,brick:1,wool:1,grain:1}"));
  assert.ok(ui.includes("action(grid,label,symbol,run,cost)"));
});
