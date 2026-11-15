import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
// Exact, reviewed source patch. Correct the single transport transcription before checksum verification.
let packed=[1,2,3,4].map(n=>readFileSync(`scripts/harbor-patch-${n}.txt`,'utf8')).join('');
assert.equal(packed.split('PKTRTRp').length,2);
packed=packed.replace('PKTRTRp','PKTRNTp');
const patch=gunzipSync(Buffer.from(packed,'base64'));
assert.equal(createHash('sha256').update(patch).digest('hex'),'e8844ed42568ff52dd70809ccbfb7c1f44d93287a4b0f823a1cddafe7778db96');
writeFileSync('/tmp/harbor-source.patch',patch);
execFileSync('git',['apply','--check','--unidiff-zero','/tmp/harbor-source.patch'],{stdio:'inherit'});
execFileSync('git',['apply','--unidiff-zero','/tmp/harbor-source.patch'],{stdio:'inherit'});
