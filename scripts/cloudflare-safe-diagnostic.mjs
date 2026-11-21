const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account){console.error('Cloudflare diagnostic: credentials missing.');process.exit(2);}
async function probe(label,url){
  try{
    const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    let body={};try{body=await res.json();}catch{}
    const errors=Array.isArray(body?.errors)?body.errors:[];
    const codes=errors.map(e=>typeof e?.code==='number'?e.code:null).filter(x=>x!==null);
    console.log(`${label}: HTTP ${res.status}; success=${body?.success===true}; cf_codes=${codes.length?codes.join(','):'none'}`);
    return {status:res.status,success:body?.success===true,codes};
  }catch{
    console.log(`${label}: network-failure`);
    return {status:0,success:false,codes:[]};
  }
}
const verify=await probe('token_verify','https://api.cloudflare.com/client/v4/user/tokens/verify');
const subdomain=await probe('workers_subdomain',`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`);
const scripts=await probe('workers_scripts',`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`);
const qa=await probe('qa_worker_settings',`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/hex-island-signaling-qa/settings`);
if(!verify.success||!subdomain.success||!scripts.success)process.exitCode=3;
if(qa.status===404)console.log('qa_worker_state: not-created');
else if(qa.success)console.log('qa_worker_state: exists');
else console.log('qa_worker_state: inaccessible');
