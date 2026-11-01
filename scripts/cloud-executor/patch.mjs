import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {validateChanges,validatePatchBytes} from './artifacts.mjs';
function git(cwd,args){const env={PATH:process.env.PATH,HOME:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};const r=spawnSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','credential.helper=','-c','diff.external=',...args],{cwd,env,stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error('Git patch validation failed');return r.stdout;}
export function applyValidatedPatch(cwd,base,patchFile,result){
 if(!/^[a-f0-9]{40}$/.test(base)||git(cwd,['rev-parse','HEAD']).toString().trim()!==base||git(cwd,['status','--porcelain','--untracked-files=all']).length)throw Error('Checkout is not pristine base');
 const patch=validatePatchBytes(readFileSync(patchFile));
 // Reject all mode changes involving symlinks or gitlinks before applying any bytes.
 if(/^(?:new file mode|deleted file mode|old mode|new mode|index [^\n]*?)(?:[^\n]* )?(?:120000|160000)\s*$/m.test(patch.toString('latin1')))throw Error('Unsafe patch mode');
 git(cwd,['apply','--check','--index','--binary',patchFile]);git(cwd,['apply','--index','--binary',patchFile]);
 const raw=git(cwd,['diff','--cached','--raw','--no-abbrev','-z','--no-renames','--no-ext-diff',base]);const paths=validateChanges(raw);
 if(paths.length!==new Set(paths).size||result.changedFiles.length!==new Set(result.changedFiles).size||[...paths].sort().join('\0')!==[...result.changedFiles].sort().join('\0'))throw Error('Changed files mismatch');
 if(git(cwd,['diff','--name-only','-z']).length || git(cwd,['ls-files','--others','--exclude-standard','-z']).length)throw Error('Unrepresented working changes');
 return paths;
}
