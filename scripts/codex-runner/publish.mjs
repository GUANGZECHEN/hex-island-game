import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import { repository, validPullRequest } from './logic.mjs';

let gitExecutable;
function trustedGit(workspace) {
 if(gitExecutable)return gitExecutable;
 const roots=[workspace,process.env.GITHUB_WORKSPACE].filter(Boolean).map(p=>realpathSync(p));
 for(const dir of (process.env.PATH || '').split(delimiter)) {
  if(!isAbsolute(dir))continue;const candidate=join(dir,process.platform==='win32'?'git.exe':'git');if(!existsSync(candidate))continue;
  const path=realpathSync(candidate);if(roots.some(root=>{const r=relative(root,path);return r==='' || (!r.startsWith('..') && !isAbsolute(r));}))continue;
  gitExecutable=path;return path;
 }
 throw Error('Trusted Git executable unavailable.');
}
// Git runs without the workflow token, helper, hooks, user configuration or external diff.
export function git(workspace, args, binary=false) {
 const env={}; for(const key of ['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP']) if(process.env[key]) env[key]=process.env[key];
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_PAGER:'cat'});
 const r=spawnSync(trustedGit(workspace),['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','credential.helper=','-c','diff.external=',...args],{cwd:workspace,env,stdio:['ignore','pipe','pipe'],encoding:binary?null:'utf8',maxBuffer:12*1024*1024,windowsHide:true});
 if(r.error || r.status!==0) throw Error('Git validation failed.'); return binary?r.stdout:r.stdout.trim();
}
export async function publish({workspace, base, branch, number, result, request}) {
 if (!/^codex\/issue-[0-9]+-[0-9]+-[0-9]+$/.test(branch) || !branch.startsWith(`codex/issue-${number}-`)) throw Error('Invalid branch.');
 if (typeof result.title!=='string' || !result.title.trim() || result.title.length>160 || /[\r\n]/.test(result.title) || typeof result.body!=='string' || !result.body.trim() || result.body.length>30000) throw Error('Invalid PR metadata.');
 const actualBranch=git(workspace,['symbolic-ref','--quiet','--short','HEAD']);
 const head=git(workspace,['rev-parse','--verify','HEAD']);
 if(actualBranch!==branch || !/^[a-f0-9]{40}$/.test(head) || head===base || git(workspace,['status','--porcelain','--untracked-files=all'])) throw Error('Unexpected branch, commit or worktree.');
 git(workspace,['merge-base','--is-ancestor',base,head]);
 const remoteMain=await request('/git/ref/heads/main'); if(remoteMain.object?.sha!==base) throw Error('Main changed; retry from the current base.');
 // Avoid creating duplicate issue PRs. Never overwrite an existing branch automatically.
 for(let page=1;page<=10;page++) { const pulls=await request(`/pulls?state=open&base=main&per_page=100&page=${page}`); if(!Array.isArray(pulls)) throw Error('Invalid PR list.'); if(pulls.some(p=>typeof p.head?.ref==='string' && p.head.ref.startsWith(`codex/issue-${number}-`))) throw Error('An issue branch already has an open PR.'); if(pulls.length<100) break; if(page===10) throw Error('PR list limit exceeded.'); }
 const raw=git(workspace,['diff-tree','--raw','-r','-z','--no-renames','--no-ext-diff',base,head],true);
 const records=raw.toString('utf8').split('\0'); const tree=[];
 for(let i=0;i<records.length-1;i+=2){ const meta=/^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADM])$/.exec(records[i]); const path=records[i+1]; if(!meta || !path || path.startsWith('/') || path.split('/').some(p=>p==='..' || p==='.git') || !['000000','100644','100755','120000'].includes(meta[2])) throw Error('Unsupported file change.');
  if(meta[5]==='D'){tree.push({path,mode:meta[1],type:'blob',sha:null});continue;}
  if(meta[2]==='000000') throw Error('Invalid file mode.');
  const content=git(workspace,['cat-file','blob',meta[4]],true); if(content.length>8*1024*1024) throw Error('File exceeds publication limit.');
  const blob=await request('/git/blobs',{method:'POST',body:JSON.stringify({content:content.toString('base64'),encoding:'base64'})}); if(blob.sha!==meta[4]) throw Error('Blob mismatch.');
  tree.push({path,mode:meta[2],type:'blob',sha:blob.sha});
 }
 if(!tree.length) throw Error('No changes to publish.');
 const baseCommit=await request(`/git/commits/${base}`); if(!baseCommit.tree?.sha) throw Error('Missing base tree.');
 const newTree=await request('/git/trees',{method:'POST',body:JSON.stringify({base_tree:baseCommit.tree.sha,tree})});
 const localTree=git(workspace,['rev-parse',`${head}^{tree}`]); if(newTree.sha!==localTree) throw Error('Tree mismatch.');
 const commit=await request('/git/commits',{method:'POST',body:JSON.stringify({message:`Task #${number}: ${result.title}`,tree:newTree.sha,parents:[base]})});
 await request('/git/refs',{method:'POST',body:JSON.stringify({ref:`refs/heads/${branch}`,sha:commit.sha})});
 const body=`${result.body}\n\nRelates to #${number}`;
 const pr=await request('/pulls',{method:'POST',body:JSON.stringify({title:result.title,body,head:branch,base:'main'})});
 if(!validPullRequest(pr,number,branch)) throw Error('Created PR failed verification.');
 return pr;
}
