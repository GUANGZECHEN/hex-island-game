import test from 'node:test';
import assert from 'node:assert/strict';
import { deployedWorkerOrigin } from '../scripts/signaling-deploy-origin.mjs';
const name='hex-island-signaling';
const record=(targets:unknown,extra:Record<string,unknown>={})=>JSON.stringify({type:'deploy',version:1,worker_name:name,version_id:'deployment-id',targets,...extra});
test('uses the structured Wrangler output and returns the unique expected production origin',()=>{
 assert.equal(deployedWorkerOrigin(record(['https://hex-island-signaling.owner-subdomain.workers.dev']),name),'https://hex-island-signaling.owner-subdomain.workers.dev');
 assert.equal(deployedWorkerOrigin(record(['https://hex-island-signaling.owner.workers.dev/','https://hex-island-signaling.owner.workers.dev']),name),'https://hex-island-signaling.owner.workers.dev');
});
test('rejects missing, malformed, non-production, ambiguous and unsafe targets',()=>{
 for(const output of ['', '{}', record([]), record(['https://other.owner.workers.dev']), record(['http://hex-island-signaling.owner.workers.dev']), record(['https://hex-island-signaling.owner.workers.dev/path']), record(['https://user:pass@hex-island-signaling.owner.workers.dev']), record(['https://hex-island-signaling.owner.workers.dev?x=1']), record(['https://hex-island-signaling.a.workers.dev','https://hex-island-signaling.b.workers.dev']), record(['https://hex-island-signaling.a.workers.dev'],{version_id:null}), 'not json']) assert.throws(()=>deployedWorkerOrigin(output,name));
});

test('temporary and permanent deployment modes require zero or both credentials',async()=>{
 const {selectDeploymentMode}=await import('../scripts/signaling-deploy-mode.mjs');
 assert.equal(selectDeploymentMode(undefined,undefined),'temporary');
 assert.equal(selectDeploymentMode('',''),'temporary');
 assert.equal(selectDeploymentMode('token','account'),'permanent');
 assert.throws(()=>selectDeploymentMode('token',''),/both/);
 assert.throws(()=>selectDeploymentMode('','account'),/both/);
});

test('claim credentials never appear in safe output, summary, logs or parser errors',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'hex-origin-test-'));const claim='https://claim.invalid/SECRET_CLAIM_CANARY';
 try{
  const input=join(dir,'input'),output=join(dir,'output'),summary=join(dir,'summary');
  writeFileSync(input,record(['https://hex-island-signaling.temporary-123.workers.dev'],{claim_url:claim}));
  const child=spawnSync(process.execPath,['../scripts/signaling-deploy-origin.mjs',input,'temporary'],{cwd:'signaling',env:{...process.env,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary},encoding:'utf8'});
  assert.equal(child.status,0);const safe=child.stdout+child.stderr+readFileSync(output,'utf8')+readFileSync(summary,'utf8');
  assert.ok(safe.includes('https://hex-island-signaling.temporary-123.workers.dev'));assert.ok(safe.includes('60 minutes'));assert.ok(!safe.includes(claim));
  writeFileSync(input,`invalid ${claim}`);const failed=spawnSync(process.execPath,['../scripts/signaling-deploy-origin.mjs',input,'temporary'],{cwd:'signaling',env:{...process.env,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary},encoding:'utf8'});
  assert.equal(failed.status,1);assert.ok(!(failed.stdout+failed.stderr).includes(claim));assert.throws(()=>deployedWorkerOrigin(`invalid ${claim}`,name),error=>!String(error).includes(claim));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('manual QA Pages uses the deployed origin while Wrangler output is captured and cleaned',async()=>{
 const {readFileSync}=await import('node:fs');
 const pages=readFileSync('.github/workflows/pages.yml','utf8'),workflow=readFileSync('.github/workflows/deploy-signaling.yml','utf8'),script=readFileSync('scripts/deploy-signaling.sh','utf8');
 assert.ok(pages.includes('needs.signaling.outputs.worker_origin || vars.SIGNALING_URL'));
 assert.ok(pages.includes("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/game/mvp'"));
 assert.ok(workflow.includes('bash ../scripts/deploy-signaling.sh'));
 assert.ok(script.includes('wrangler_config="${WRANGLER_CONFIG:-wrangler.jsonc}"'));
 assert.ok(script.includes('wrangler deploy --temporary --config "$wrangler_config" >"$temporary_dir/wrangler.log" 2>&1'));
 assert.ok(script.includes('wrangler deploy --config "$wrangler_config" >"$temporary_dir/wrangler.log" 2>&1'));
 assert.ok(script.includes("trap 'rm -rf -- \"$temporary_dir\"' EXIT"));
 const qa=readFileSync('.github/workflows/qa-pages.yml','utf8');
 assert.ok(qa.includes('WRANGLER_CONFIG: wrangler.qa.jsonc'));
 assert.ok(qa.includes('hex-island-signaling-qa'));
 assert.ok(!workflow.includes('upload-artifact'));
});

test('deployment wrapper suppresses and deletes claim material on success and failure',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,chmodSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'hex-wrapper-test-')),bin=join(dir,'bin'),runner=join(dir,'runner');const claim='https://claim.invalid/SECRET_CLAIM_CANARY';
 try {
  mkdirSync(bin);mkdirSync(runner);const npm=join(bin,'npm');
  writeFileSync(npm,`#!/usr/bin/env bash\nmkdir -p "$XDG_CONFIG_HOME"\nprintf '%s' "$CLAIM_CANARY" > "$XDG_CONFIG_HOME/secret"\nprintf '%s\\n' "$CLAIM_CANARY"\nif [[ "\${MOCK_FAILURE:-}" == yes ]]; then exit 1; fi\nprintf '%s\\n' '{"type":"deploy","version":1,"worker_name":"hex-island-signaling","version_id":"v","targets":["https://hex-island-signaling.temporary-123.workers.dev"],"claim_url":"'"$CLAIM_CANARY"'"}' > "$WRANGLER_OUTPUT_FILE_PATH"\n`);chmodSync(npm,0o700);
  const fakeNode=join(bin,'node');writeFileSync(fakeNode,`#!/usr/bin/env bash\nif [[ "$1" == scripts/smoke.mjs ]]; then [[ "\${MOCK_SMOKE_FAIL:-no}" != yes ]]; exit $?; fi\nexec "${process.execPath}" "$@"\n`);chmodSync(fakeNode,0o700);
  for(const mode of ['temporary','permanent'])for(const failure of [false,true]){
   const output=join(dir,`${mode}-${failure}-output`),summary=join(dir,`${mode}-${failure}-summary`);
   const env={...process.env,PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:runner,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary,DEPLOYMENT_MODE:mode,MOCK_FAILURE:failure?'yes':'no',CLAIM_CANARY:claim,CLOUDFLARE_API_TOKEN:mode==='permanent'?'token':'',CLOUDFLARE_ACCOUNT_ID:mode==='permanent'?'account':''};
   const child=spawnSync('bash',[resolve('scripts/deploy-signaling.sh')],{cwd:'signaling',env,encoding:'utf8'});
   assert.equal(child.status,failure?1:0,child.stderr);
   let visible=child.stdout+child.stderr;if(!failure)visible+=readFileSync(output,'utf8')+readFileSync(summary,'utf8');
   assert.ok(!visible.includes(claim));assert.deepEqual(readdirSync(runner),[]);
  }
  const output=join(dir,'smoke-failed-output'),summary=join(dir,'smoke-failed-summary');
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:runner,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary,DEPLOYMENT_MODE:'temporary',MOCK_FAILURE:'no',MOCK_SMOKE_FAIL:'yes',CLAIM_CANARY:claim,CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''};
  const blocked=spawnSync('bash',[resolve('scripts/deploy-signaling.sh')],{cwd:'signaling',env,encoding:'utf8'});
  assert.notEqual(blocked.status,0);assert.ok(!(blocked.stdout+blocked.stderr).includes(claim));assert.ok(!readdirSync(dir).includes('smoke-failed-output'));assert.ok(!readdirSync(dir).includes('smoke-failed-summary'));assert.deepEqual(readdirSync(runner),[]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
