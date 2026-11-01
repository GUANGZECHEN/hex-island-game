import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('one-shot runner rechecks issue and transitions only after verified PR', {skip:process.platform==='win32'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-runner-test-'));
 try {
  const exe=join(dir,'powershell.exe'),event=join(dir,'event.json'),preload=join(dir,'mock.mjs'),log=join(dir,'calls.json');
  writeFileSync(event,JSON.stringify({issue:{number:6},sender:{login:'GUANGZECHEN'}}));
  writeFileSync(exe,`#!/usr/bin/env node\nconst fs=require('fs'),p=fs.readFileSync(process.env.CODEX_PROMPT,'utf8');if(!p.includes('issue #6')||p.includes('UNTRUSTED_BODY'))process.exit(2);fs.writeFileSync(process.env.CODEX_RESULT,JSON.stringify({outcome:'pr',pr_number:7}));\n`);chmodSync(exe,0o755);
  writeFileSync(preload,`import fs from 'node:fs'; let title='[READY] task'; const calls=[]; globalThis.fetch=async(url,opts={})=>{const method=opts.method||'GET';calls.push({url,method});let data;if(url.endsWith('/pulls/7'))data={number:7,state:'open',base:{ref:'main',repo:{full_name:'GUANGZECHEN/hex-island-game'}},head:{ref:'codex/issue-6-example',repo:{full_name:'GUANGZECHEN/hex-island-game'}},body:'Closes #6'};else if(method==='PATCH'){title=JSON.parse(opts.body).title;data={title}}else data={state:'open',title,user:{login:'GUANGZECHEN'},body:'UNTRUSTED_BODY'};fs.writeFileSync(process.env.MOCK_LOG,JSON.stringify(calls));return {ok:true,status:200,json:async()=>data};};`);
  const env={...process.env,PATH:`${dir}:${process.env.PATH}`,NODE_OPTIONS:`--import=${preload}`,GITHUB_EVENT_PATH:event,GITHUB_REPOSITORY:'GUANGZECHEN/hex-island-game',GITHUB_TOKEN:'test-token',GH_TOKEN:'test-token',RUNNER_TEMP:dir,GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKSPACE:dir,MOCK_LOG:log};
  const run=spawnSync(process.execPath,[resolve('scripts/codex-runner/run.mjs')],{env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr); assert.doesNotMatch(run.stdout+run.stderr,/UNTRUSTED_BODY|test-token/); const calls=JSON.parse(readFileSync(log)); assert.equal(calls.filter(x=>x.method==='PATCH').length,2);assert.ok(calls.some(x=>x.url.endsWith('/pulls/7')));assert.equal(existsSync(join(dir,'codex-result-1-1.json')),false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
