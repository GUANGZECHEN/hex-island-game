import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
// Exact reviewed local changes. Checksums prevent transport/transcription changes.
const packed=Array.from({length:26},(_,n)=>readFileSync(`scripts/station-patch-${String(n).padStart(2,'0')}.txt`,'utf8')).join('');
for(const [name,encoded,hash,zero] of [
 ['stations',packed,'70e6126064772f63ef2477027722bd262e7425724d9c0353662feb8320e7eac9',true],
 ['owned-roads',readFileSync('scripts/station-owned-roads.txt','utf8'),'096676a17570a179b4cc22c68d180a64d8e0845ced2c331eda44442e0ecc54a0',false],
]){
 const patch=gunzipSync(Buffer.from(encoded,'base64'));
 assert.equal(createHash('sha256').update(patch).digest('hex'),hash,`${name} source checksum`);
 const path=`/tmp/harbor-${name}.patch`;writeFileSync(path,patch);
 const args=['--binary',...(zero?['--unidiff-zero']:[])];
 execFileSync('git',['apply','--check',...args,path],{stdio:'inherit'});
 execFileSync('git',['apply',...args,path],{stdio:'inherit'});
}
