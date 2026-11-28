import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('temporary ingress keeps monitoring after repeated failures and records recovery',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qa-monitor-'));
  try {
    const bin=join(dir,'bin');await mkdir(bin);
    const files:Record<string,string>={
      date:'#!/bin/bash\ncat "$FAKE_CLOCK"\n',
      sleep:'#!/bin/bash\nn=$(cat "$FAKE_CLOCK"); if (( n >= 240 )); then n=18000; else n=$((n+$1)); fi; echo "$n" > "$FAKE_CLOCK"\n',
      curl:'#!/bin/bash\nn=$(cat "$FAKE_COUNT"); n=$((n+1)); echo "$n" > "$FAKE_COUNT"; if (( n <= 3 )); then printf 503; else printf 204; fi\n',
    };
    for(const [name,content] of Object.entries(files))await writeFile(join(bin,name),content,{mode:0o755});
    await writeFile(join(dir,'clock'),'0\n');await writeFile(join(dir,'count'),'0\n');
    for(const name of ['cloudflared-qa.pid','wrangler-qa.pid'])await writeFile(join(dir,name),String(process.pid));
    const run=spawnSync('bash',['scripts/keep-qa-ingress.sh'],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,FAKE_CLOCK:join(dir,'clock'),FAKE_COUNT:join(dir,'count'),RUNNER_TEMP:dir,GITHUB_STEP_SUMMARY:join(dir,'summary'),QA_SIGNALING_URL:'https://example.trycloudflare.com'}});
    assert.equal(run.status,0,run.stderr);
    assert.equal((await readFile(join(dir,'count'),'utf8')).trim(),'4');
    assert.equal((await readFile(join(dir,'clock'),'utf8')).trim(),'18000');
    assert.match(run.stdout,/probe failed/);assert.match(run.stdout,/probe recovered/);
    assert.equal((run.stdout.match(/probe failed/g)||[]).length,1);
    assert.match(await readFile(join(dir,'summary'),'utf8'),/probe recovered/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
