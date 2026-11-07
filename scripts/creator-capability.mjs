import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;

export function creatorCapabilityHash(capability) {
 if(!TOKEN.test(capability))throw new Error('Creator capability must be a 256-bit base64url token.');
 return createHash('sha256').update(capability,'utf8').digest('hex');
}

export function generateCreatorCapability() {
 const capability=randomBytes(32).toString('base64url');
 return {capability,hash:creatorCapabilityHash(capability)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv[2]==='--hash'){
   const capability=process.argv[3]??'';
   console.log(creatorCapabilityHash(capability));
  }else{
   const value=generateCreatorCapability();
   if(process.argv[2]==='--machine')process.stdout.write(`${value.capability}\t${value.hash}\n`);
   else{
    console.log(`Creator capability: ${value.capability}`);
    console.log(`CREATOR_CAPABILITY_HASH: ${value.hash}`);
    console.log('Keep the capability private. Configure only the hash on the Worker.');
   }
  }
 }catch{
  console.error('Could not generate or hash a creator capability.');
  process.exitCode=1;
 }
}
