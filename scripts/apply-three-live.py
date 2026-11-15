"""One-time, asserted integration patch; CI deletes this after tested source is committed."""
from pathlib import Path
import json

def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    if new in s:
        return
    if old not in s:
        raise RuntimeError(f'Missing integration anchor in {path}: {old[:90]}')
    p.write_text(s.replace(old, new, 1))

p = Path('package.json')
data = json.loads(p.read_text())
data.setdefault('dependencies', {})['three'] = '0.180.0'
data.setdefault('devDependencies', {})['@types/three'] = '0.180.0'
p.write_text(json.dumps(data, indent=2) + '\n')
replace('src/game-ui.ts', "import './style.css';", "import './style.css';\nimport { BoardRendererController } from './game/board/three/controller';")
replace('src/game-ui.ts', 'function drawBoard(){', '''let boardRenderer:BoardRendererController|null=null;
function drawBoard(){
 if(!state)return;
 if(!boardRenderer)boardRenderer=new BoardRendererController(el('board'),drawSvgBoard,id=>attempt(()=>moveTarget(id)));
 boardRenderer.update({board:state.board,roads:state.roads,buildings:state.buildings,
  players:state.players.map(p=>({id:p.id,name:playerName(p.id),color:PLAYER_PIECE_PALETTE[p.seat]?.body??'#68767b'})),
  targetMode,legalTargets:targetMode?legalTargetIds(state,viewer,targetMode):[]});
}
function drawSvgBoard(){''')
replace('index.html', '<p class="board-help">Choose an action, then select a highlighted target on the board.</p>', '<div class="board-view-toolbar" aria-label="Board view controls"><button id="board-view-reset" type="button">Reset view</button><button id="board-view-top" type="button">Top view</button><button id="board-render-toggle" type="button">2D view</button><label class="board-view-touch"><input id="board-adjust-view" type="checkbox">Adjust view</label><p id="board-render-mode" role="status"></p></div><p class="board-help">Choose an action, then select a highlighted target on the board.</p>')
replace('src/game/ui/compact-layout.ts', '''    if (!svg) { clear(); return; }
    const bounds = svg.viewBox.baseVal;''', '''    const canvas = board.querySelector<HTMLCanvasElement>('canvas[data-board-aspect]');
    const aspect = Number(canvas?.dataset.boardAspect);
    if (!svg && !(aspect > 0)) { clear(); return; }
    const bounds = svg ? svg.viewBox.baseVal : {width:aspect, height:1};''')
replace('src/game/ui/compact-layout.ts', '  mutation.observe(board, {childList: true});', "  mutation.observe(board, {childList: true});\n  board.addEventListener('board-layout-ready', schedule);")
replace('src/game/ui/compact-layout.ts', '    resize?.disconnect(); mutation.disconnect();', "    resize?.disconnect(); mutation.disconnect();\n    board.removeEventListener('board-layout-ready', schedule);")
replace('scripts/qa-e2e.mjs', 'const qaUrl=process.env.QA_URL;', "const baseQaUrl=process.env.QA_URL;\nconst fallbackUrl=baseQaUrl?new URL(baseQaUrl):null;if(fallbackUrl)fallbackUrl.searchParams.set('renderer','2d');\nconst qaUrl=fallbackUrl?.href;")
replace('.github/workflows/qa-pages.yml', 'cp scripts/qa-e2e.mjs "$RUNNER_TEMP/qa-e2e/qa-e2e.mjs"', 'cp scripts/qa-e2e.mjs scripts/qa-three-live.mjs "$RUNNER_TEMP/qa-e2e/"')
replace('.github/workflows/qa-pages.yml', 'npm install --silent playwright@1.58.0', 'npm install --silent playwright@1.58.0 pngjs@7.0.0')
replace('.github/workflows/qa-pages.yml', '''          node qa-e2e.mjs

      - name: Report QA environment''', '''          node qa-e2e.mjs
          node qa-three-live.mjs

      - name: Upload integrated 3D evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integrated-three-evidence
          retention-days: 7
          if-no-files-found: ignore
          path: ${{ runner.temp }}/qa-e2e/three-evidence

      - name: Report QA environment''')
