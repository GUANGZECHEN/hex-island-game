import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(await readFile('scripts/release-seven/manifest.json','utf8'));
const paths=[...Object.keys(manifest),'design_principles/01_product_scope.docx','design_principles/04_decision_log.docx'];
if(!process.env.GH_TOKEN||process.env.GITHUB_REPOSITORY!=='GUANGZECHEN/hex-island-game')throw new Error('Unexpected export environment');
const tree=[];
for(const path of paths){
 const data=await readFile(path),expected=createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
 if(manifest[path]&&manifest[path]!==expected)throw new Error(`Source changed after verification: ${path}`);
 const r=await fetch('https://api.github.com/repos/GUANGZECHEN/hex-island-game/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content:data.toString('base64'),encoding:'base64'})});
 if(!r.ok)throw new Error(`Export failed ${r.status}: ${path}`);
 const value=await r.json();if(value.sha!==expected)throw new Error(`Blob mismatch: ${path}`);
 tree.push({path,mode:'100644',type:'blob',sha:value.sha});
}
await mkdir('release-evidence',{recursive:true});
await writeFile('release-evidence/source-blobs.json',JSON.stringify({base:'40710e2075088df5f2cc9c1da33da0dd6a40da75',head:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,tree},null,2));
execFileSync('tar',['czf','release-evidence/verified-source.tar.gz',...paths]);
console.log(`Exported ${tree.length} verified source blobs without updating any live branch.`);
