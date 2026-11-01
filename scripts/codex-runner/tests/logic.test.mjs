import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, stateTitle, validPullRequest, bootstrap } from '../logic.mjs';
const issue = {state:'open',user:{login:'GUANGZECHEN'},title:'[READY] task'};
test('only owner-authored open READY issues are eligible',()=>{assert.ok(eligible(issue));for(const bad of [{...issue,user:{login:'attacker'}},{...issue,title:'[WORKING] task'},{...issue,state:'closed'},{...issue,pull_request:{}},null])assert.ok(!eligible(bad));});
test('state changes only replace the exact expected prefix',()=>{assert.equal(stateTitle('[READY] task','READY','WORKING'),'[WORKING] task');assert.equal(stateTitle('[DECISION] task','WORKING','BLOCKED'),null);assert.equal(stateTitle('[READYING] task','READY','WORKING'),null);});
test('PR must target main from a dedicated branch and link the exact issue',()=>{const pr={number:3,state:'open',base:{ref:'main',repo:{full_name:'GUANGZECHEN/hex-island-game'}},head:{ref:'codex/issue-6-test',repo:{full_name:'GUANGZECHEN/hex-island-game'}},body:'Closes #6'};assert.ok(validPullRequest(pr,6,{pr_number:3}));assert.ok(!validPullRequest({...pr,body:'Closes #60'},6,{pr_number:3}));assert.ok(!validPullRequest({...pr,head:{...pr.head,ref:'main'}},6,{pr_number:3}));assert.ok(!validPullRequest({...pr,base:{...pr.base,ref:'other'}},6,{pr_number:3}));});
test('bootstrap takes a numeric identifier and no issue content',()=>{assert.throws(()=>bootstrap('6; shell injection'));assert.throws(()=>bootstrap(-1));assert.match(bootstrap(6),/issue #6/);assert.ok(!bootstrap(6).includes('$(malicious)'));});
