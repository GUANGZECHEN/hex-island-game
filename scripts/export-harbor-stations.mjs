import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['design_principles/01_product_scope.docx','design_principles/01_product_scope.md','design_principles/04_decision_log.docx','design_principles/04_decision_log.md','docs/harbor-coop-v1.md','docs/harbor-coop.md','scripts/qa-harbor-coop.mjs','src/game-ui.ts','src/game/board/three/model.ts','src/game/board/three/renderer.ts','src/game/board/three/trade-station-art.ts','src/game/bot/harbor.ts','src/game/bot/runner.ts','src/game/network/authority.ts','src/game/rules/economy.ts','src/game/rules/harbor.ts','src/game/rules/legal.ts','src/game/rules/state.ts','src/game/rules/trade-stations.ts','src/game/ui/compact-actions.ts','src/game/ui/harbor.ts','src/harbor.css','tests/harbor-coop.test.ts','tests/harbor-stations.test.ts','tests/target-feedback.test.ts','src/game/rules/build.ts','scripts/sync-harbor-docs.py','tests/harbor-road-ownership.test.ts'];
if(!process.env.GH_TOKEN)throw new Error('Missing source export token');
const tree=[];
for(const path of paths){
 const body=await readFile(path);
 const response=await fetch('https://api.github.com/repos/GUANGZECHEN/hex-island-game/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content:body.toString('base64'),encoding:'base64'})});
 if(!response.ok)throw new Error(`Export failed (${response.status}): ${path}`);
 const result=await response.json();
 const expected=createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
 if(result.sha!==expected)throw new Error(`Blob mismatch: ${path}`);
 tree.push({path,mode:'100644',type:'blob',sha:result.sha});
}
await mkdir('harbor-evidence',{recursive:true});
await writeFile('harbor-evidence/source-blobs.json',JSON.stringify({base:'897264f83aef6f4d13a1fde2f8fa936759753d59',run:process.env.GITHUB_RUN_ID,head:process.env.GITHUB_SHA,tree},null,2));
console.log(`Exported ${tree.length} checked source blobs. No branch is modified by this script.`);
