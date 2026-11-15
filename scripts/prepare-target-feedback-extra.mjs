import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
function replace(path,from,to){let s=readFileSync(path,'utf8');assert.equal(s.split(from).length-1,1,path+': missing unique anchor');writeFileSync(path,s.replace(from,to));}
replace('src/game/board/three/controller.ts',"for (const target of this.host.querySelectorAll<SVGElement>('[data-target-id]'))", "for (const target of Array.from(this.host.querySelectorAll<SVGElement>('[data-target-id]')))");
replace('src/game/board/three/renderer.ts',"this.controls.addEventListener('start', () => { this.manualView = true; this.leaveTarget(); });", "this.controls.addEventListener('start', () => { this.manualView = true; });\n    this.controls.addEventListener('start', this.leaveTarget);");
replace('.github/workflows/qa-pages.yml','cp scripts/qa-e2e.mjs scripts/qa-three-live.mjs scripts/qa-compact-actions.mjs ', 'cp scripts/qa-e2e.mjs scripts/qa-three-live.mjs scripts/qa-compact-actions.mjs scripts/qa-target-feedback.mjs ');
replace('.github/workflows/qa-pages.yml','          node qa-compact-actions.mjs\n','          node qa-compact-actions.mjs\n          node qa-target-feedback.mjs\n');
replace('.github/workflows/qa-pages.yml','            ${{ runner.temp }}/qa-e2e/compact-action-evidence\n','            ${{ runner.temp }}/qa-e2e/compact-action-evidence\n            ${{ runner.temp }}/qa-e2e/target-evidence\n');
