import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
// Replay exactly the previously tested SOURCE update, never a compiled bundle patch.
const packed=Array.from({length:12},(_,n)=>readFileSync(`scripts/release-seven/part-${String(n).padStart(2,'0')}.txt`,'utf8')).join('');
assert.equal(packed.length,23820);
const patch=gunzipSync(Buffer.from(packed,'base64'));
assert.equal(createHash('sha256').update(patch).digest('hex'),'c439c9dc8226be6df6cdb757d7e2440970ef7340395a7e27df3a031b255ac90e');
const path='/tmp/harbor-seven-source.patch';writeFileSync(path,patch);
execFileSync('git',['apply','--check',path],{stdio:'inherit'});
execFileSync('git',['apply',path],{stdio:'inherit'});
const manifest=JSON.parse(readFileSync('scripts/release-seven/manifest.json','utf8'));
for(const [path,expected] of Object.entries(manifest)){
 const data=readFileSync(path);
 const actual=createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
 assert.equal(actual,expected,`Exact source match: ${path}`);
}
console.log('All 13 source files exactly match the locally tested update.');
