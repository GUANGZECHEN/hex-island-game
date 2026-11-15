import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['.github/workflows/qa-pages.yml','design_principles/01_product_scope.docx','design_principles/01_product_scope.md','design_principles/04_decision_log.docx','design_principles/04_decision_log.md','docs/harbor-coop.md','index.html','scripts/qa-harbor-coop.mjs','scripts/sync-harbor-docs.py','src/game-ui.ts','src/game/board/three/model.ts','src/game/board/three/renderer.ts','src/game/bot/harbor.ts','src/game/bot/policy.ts','src/game/bot/runner.ts','src/game/network/authority.ts','src/game/network/browser.ts','src/game/network/recovery.ts','src/game/network/session.ts','src/game/rules/build.ts','src/game/rules/economy.ts','src/game/rules/harbor.ts','src/game/rules/state.ts','src/game/rules/turn.ts','src/game/ui/harbor.ts','src/game/ui/interactions.ts','src/game/ui/local-room.ts','src/harbor.css','tests/harbor-coop.test.ts','tests/ui-layout-contract.test.ts'];
if(!process.env.GH_TOKEN)throw new Error('Missing repository export token');
const tree=[];
for(const path of paths){
 const body=await readFile(path);
 const response=await fetch('https://api.github.com/repos/GUANGZECHEN/hex-island-game/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content:body.toString('base64'),encoding:'base64'})});
 if(!response.ok)throw new Error(`Blob export failed (${response.status}) for ${path}`);
 const result=await response.json();
 const expected=createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
 if(result.sha!==expected)throw new Error(`Blob digest mismatch: ${path}`);
 tree.push({path,mode:'100644',type:'blob',sha:result.sha});
}
await mkdir('harbor-evidence',{recursive:true});
await writeFile('harbor-evidence/source-blobs.json',JSON.stringify({base:'75b108667d22c9cbcda042bfa0d274751bdba6c2',run:process.env.GITHUB_RUN_ID,head:process.env.GITHUB_SHA,tree},null,2));
// Creating blob objects never updates a branch or publishes a website.
console.log(`Exported ${tree.length} verified source blobs.`);
