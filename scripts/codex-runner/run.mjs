import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eligible, stateTitle, validPullRequest, bootstrap, repository, owner } from './logic.mjs';

const token = process.env.GITHUB_TOKEN;
const workspace = process.cwd();
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const number = event.issue?.number;
const api = `https://api.github.com/repos/${repository}`;
const resultFile = join(process.env.RUNNER_TEMP, `codex-result-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`);
const promptFile = join(process.env.RUNNER_TEMP, `codex-prompt-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.txt`);
let claimed = false;
async function request(path, options={}) {
  const r = await fetch(`${api}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28', ...options.headers } });
  if (!r.ok) throw Error(`GitHub API request failed (${r.status}).`);
  return r.status === 204 ? null : r.json();
}
async function getIssue(){ return request(`/issues/${number}`); }
async function transition(from, to) {
  const issue = await getIssue();
  if (issue.user?.login !== owner || issue.state !== 'open') return false;
  const title = stateTitle(issue.title,from,to); if (!title) return false;
  await request(`/issues/${number}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
  return true;
}
async function comment(message) { await request(`/issues/${number}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:message})}); }
function codex() {
  rmSync(resultFile,{force:true});
  writeFileSync(promptFile,bootstrap(number),{encoding:'utf8',mode:0o600});
  // Resolve the installed CLI, not an executable supplied by the checkout. The prompt is stdin data.
  const script = `$ErrorActionPreference='Stop'; $cmd=Get-Command codex -CommandType Application | Select-Object -First 1; if (-not $cmd) { exit 127 }; $p=[IO.Path]::GetFullPath($cmd.Source); $w=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE); if ($p.StartsWith($w,[StringComparison]::OrdinalIgnoreCase)) { exit 126 }; Get-Content -Raw -LiteralPath $env:CODEX_PROMPT | & $p -a never -c 'sandbox_workspace_write.network_access=true' -c 'shell_environment_policy.ignore_default_excludes=true' exec --ignore-user-config --ephemeral --sandbox workspace-write --cd $env:CODEX_TASK_DIR --output-schema $env:CODEX_SCHEMA --output-last-message $env:CODEX_RESULT -; exit $LASTEXITCODE`;
  const env={};
  for (const key of ['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','CODEX_HOME','GITHUB_WORKSPACE','GH_TOKEN','GITHUB_TOKEN']) if (process.env[key]) env[key]=process.env[key];
  Object.assign(env,{CODEX_TASK_DIR:workspace,CODEX_SCHEMA:resolve('scripts/codex-runner/result.schema.json'),CODEX_RESULT:resultFile,CODEX_PROMPT:promptFile,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:'!gh auth git-credential'});
  // CLI output can contain issue text or other sensitive data: never echo it or upload it.
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{cwd:workspace,env,stdio:['ignore','ignore','ignore'],timeout:105*60*1000,windowsHide:true});
  if (result.error || result.status !== 0) throw Error('Codex CLI failed or is unavailable or unauthenticated.');
  const final=JSON.parse(readFileSync(resultFile,'utf8'));
  if (!final || !['pr','decision','failed'].includes(final.outcome) || (final.outcome === 'pr' ? !Number.isSafeInteger(final.pr_number) : final.pr_number !== null)) throw Error('Codex returned an invalid result.');
  return final;
}
async function main() {
  if (!token || process.env.GITHUB_REPOSITORY !== repository || event.sender?.login !== owner || !Number.isSafeInteger(number) || number <= 0) throw Error('Authorization gate failed.');
  const issue=await getIssue();
  if (!eligible(issue)) { console.log('Issue no longer eligible; no work started.'); return; }
  if (!await transition('READY','WORKING')) { console.log('Issue state changed; no work started.'); return; }
  claimed=true;
  // Verify again after the title change and before granting the agent work.
  const current=await getIssue(); if(current.user?.login!==owner || current.state!=='open' || !current.title.startsWith('[WORKING]')) throw Error('Issue changed before execution.');
  const result=codex();
  if(result.outcome==='decision') { if(await transition('WORKING','DECISION')) await comment('A Product Owner decision is required. The runner stopped without merging. Review the task and rerun after clarification.'); return; }
  if(result.outcome!=='pr') throw Error('Task did not produce a pull request.');
  const pr=await request(`/pulls/${result.pr_number}`);
  if(!validPullRequest(pr,number,result)) throw Error('The reported pull request did not meet the task checks.');
  if(await transition('WORKING','ARCH-REVIEW')) console.log(`Issue #${number} is ready for architecture review.`);
}
try { await main(); } catch {
  console.error('Runner failed. Check runner prerequisites, Codex authentication, task tests, push and PR permissions. Sensitive output was suppressed.');
  if(claimed) try { if(await transition('WORKING','BLOCKED')) await comment('The automated run failed or did not produce a verified PR. Check runner prerequisites, Codex authentication, tests, push and PR permissions before retrying. Sensitive output was suppressed.'); } catch { console.error('Could not update issue status; an owner must inspect the run.'); }
  process.exitCode=1;
} finally { try { rmSync(resultFile,{force:true}); rmSync(promptFile,{force:true}); } catch { console.error('Could not remove the temporary result file.'); process.exitCode=1; } }
