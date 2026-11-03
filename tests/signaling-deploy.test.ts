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
