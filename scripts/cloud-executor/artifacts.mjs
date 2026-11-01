export const MAX_PATCH=2*1024*1024, MAX_RESULT=64*1024, MAX_FILES=100;
const bounded=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n;
export function validateResult(buffer) {
 if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>MAX_RESULT)throw Error('Invalid result size');
 let x;try{x=JSON.parse(buffer.toString('utf8'));}catch{throw Error('Invalid result JSON');}
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join(',')!=='changedFiles,designCompliance,status,summary,tests,unresolved' || !['ready','decision','blocked'].includes(x.status) || !bounded(x.summary,4000) || !Array.isArray(x.changedFiles) || x.changedFiles.length>MAX_FILES || !x.changedFiles.every(v=>bounded(v,1024)) || !Array.isArray(x.tests)||x.tests.length>100 || !x.tests.every(t=>t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).sort().join(',')==='command,status'&&bounded(t.command,512)&&['pass','fail','not-run'].includes(t.status)) || !Array.isArray(x.unresolved)||x.unresolved.length>100||!x.unresolved.every(v=>bounded(v,2000))||!bounded(x.designCompliance,4000))throw Error('Invalid result schema');
 if(x.status==='ready'&&(x.changedFiles.length===0||x.tests.some(t=>t.status==='fail')))throw Error('Not ready');return x;
}
export function validatePatchBytes(buffer) {if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>MAX_PATCH)throw Error('Invalid patch size');return buffer;}
export function validateChanges(raw) {
 const fields=raw.toString('utf8').split('\0');if(fields.at(-1)!=='')throw Error('Invalid diff');let count=0;const paths=[];
 for(let i=0;i<fields.length-1;i+=2){const meta=/^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADM])$/.exec(fields[i]);const path=fields[i+1];if(!meta||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'||x.toLowerCase()==='.git')||!['000000','100644','100755'].includes(meta[1])||!['000000','100644','100755'].includes(meta[2]))throw Error('Unsafe change');if(++count>MAX_FILES)throw Error('Too many files');paths.push(path);}
 if(!count)throw Error('Empty diff');return paths;
}
