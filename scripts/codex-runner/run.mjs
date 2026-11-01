import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eligible, filteredSpecification, stateTitle, bootstrap, repository, owner } from './logic.mjs';
import { git, publish } from './publish.mjs';

const token=process.env.GITHUB_TOKEN, workspace=process.cwd();
const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')), number=event.issue?.number;
const runId=process.env.GITHUB_RUN_ID, attempt=process.env.GITHUB_RUN_ATTEMPT;
if(!/^\d+$/.test(runId || '') || !/^\d+$/.test(attempt || '')) throw Error('Invalid run identity.');
const api=`https://api.github.com/repos/${repository}`;
const prefix=`codex-${runId}-${attempt}`;
const temp=process.env.RUNNER_TEMP, resultFile=join(temp,`${prefix}-result.json`), promptFile=join(temp,`${prefix}-prompt.txt`), specFile=join(temp,`${prefix}-spec.json`), ghDir=join(temp,`${prefix}-gh`), gitConfig=join(temp,`${prefix}-gitconfig`);
let claimed=false;
async function request(path,options={}) {
 const r=await fetch(`${api}${path}`,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 if(!r.ok) throw Error(`GitHub API request failed (${r.status}).`);
 return r.status===204 ? null : r.json();
}
async function getIssue(){return request(`/issues/${number}`);}
async function transition(from,to){const issue=await getIssue();if(issue.user?.login!==owner||issue.state!=='open')return false;const title=stateTitle(issue.title,from,to);if(!title)return false;await request(`/issues/${number}`,{method:'PATCH',body:JSON.stringify({title})});return true;}
async function comment(message){await request(`/issues/${number}/comments`,{method:'POST',body:JSON.stringify({body:message})});}
async function allComments(){const comments=[];for(let page=1;page<=50;page++){const batch=await request(`/issues/${number}/comments?per_page=100&page=${page}`);if(!Array.isArray(batch))throw Error('Invalid comments response.'); comments.push(...batch);if(batch.length<100)return comments;}throw Error('Comment page limit exceeded.');}
function codex(branch,spec) {
 rmSync(resultFile,{force:true});mkdirSync(ghDir,{recursive:true});writeFileSync(gitConfig,'',{mode:0o600});
 writeFileSync(specFile,JSON.stringify(spec),{encoding:'utf8',mode:0o600});writeFileSync(promptFile,bootstrap(number,branch),{encoding:'utf8',mode:0o600});
 const script=`$ErrorActionPreference='Stop'; $cmd=Get-Command codex -CommandType Application | Select-Object -First 1; if (-not $cmd) { exit 127 }; $p=[IO.Path]::GetFullPath($cmd.Source); $w=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE); if ($p.StartsWith($w,[StringComparison]::OrdinalIgnoreCase)) { exit 126 }; Get-Content -Raw -LiteralPath $env:CODEX_PROMPT | & $p -a never -c 'sandbox_workspace_write.network_access=true' exec --ignore-user-config --ephemeral --sandbox workspace-write --cd $env:CODEX_TASK_DIR --output-schema $env:CODEX_SCHEMA --output-last-message $env:CODEX_RESULT -; exit $LASTEXITCODE`;
 const env={};for(const key of ['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','CODEX_HOME','GITHUB_WORKSPACE'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{CODEX_TASK_DIR:workspace,CODEX_TASK_SPEC:specFile,CODEX_SCHEMA:resolve('scripts/codex-runner/result.schema.json'),CODEX_RESULT:resultFile,CODEX_PROMPT:promptFile,GH_CONFIG_DIR:ghDir,GIT_CONFIG_GLOBAL:gitConfig,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'});
 // The child gets no GitHub workflow token, git credential helper, or runner output.
 const child=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{cwd:workspace,env,stdio:['ignore','ignore','ignore'],timeout:105*60*1000,windowsHide:true});
 if(child.error||child.status!==0)throw Error('Codex failed or is unavailable.');
 const result=JSON.parse(readFileSync(resultFile,'utf8'));if(!result||!['ready','decision','failed'].includes(result.outcome)||typeof result.title!=='string'||typeof result.body!=='string')throw Error('Invalid result.');return result;
}
async function main(){
 if(!token||process.env.GITHUB_REPOSITORY!==repository||event.sender?.login!==owner||!Number.isSafeInteger(number)||number<=0||!/^\d+$/.test(runId)||!/^\d+$/.test(attempt))throw Error('Authorization gate failed.');
 const issue=await getIssue();if(!eligible(issue)){console.log('Issue no longer eligible; no work started.');return;}
 if(!await transition('READY','WORKING')){console.log('Issue state changed; no work started.');return;}claimed=true;
 const current=await getIssue();if(current.user?.login!==owner||current.state!=='open'||!current.title.startsWith('[WORKING]'))throw Error('Issue changed before execution.');
 const comments=await allComments(), spec=filteredSpecification(current,comments);
 const base=git(workspace,['rev-parse','--verify','HEAD']);if(!/^[a-f0-9]{40}$/.test(base))throw Error('Invalid base.');
 const branch=`codex/issue-${number}-${runId}-${attempt}`,result=codex(branch,spec);
 if(result.outcome==='decision'){if(await transition('WORKING','DECISION'))await comment('A Product Owner decision is required. The runner stopped without merging. Review the task and rerun after clarification.');return;}
 if(result.outcome!=='ready')throw Error('Task did not complete.');
 await publish({workspace,base,branch,number,result,request});
 if(await transition('WORKING','ARCH-REVIEW'))console.log(`Issue #${number} is ready for architecture review.`);
}
try{await main();}catch{console.error('Runner failed. Check the task, runner prerequisites, Codex authentication and GitHub policy. Sensitive output was suppressed.');if(claimed)try{if(await transition('WORKING','BLOCKED'))await comment('The automated run failed or did not produce a verified PR. Check runner prerequisites, Codex authentication, tests and GitHub policy before retrying. Sensitive output was suppressed.');}catch{console.error('Could not update issue status; an owner must inspect the run.');}process.exitCode=1;}
finally{try{for(const p of [resultFile,promptFile,specFile,gitConfig])rmSync(p,{force:true});rmSync(ghDir,{recursive:true,force:true});}catch{console.error('Could not remove task temporary files.');process.exitCode=1;}}
