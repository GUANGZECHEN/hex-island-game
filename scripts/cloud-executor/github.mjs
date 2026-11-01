import {repository,owner} from './policy.mjs';
export class GitHub {
 constructor(token,transport=fetch){if(!token)throw Error('Missing GitHub token');this.token=token;this.transport=transport;}
 async request(path,options={}) {const r=await this.transport(`https://api.github.com/repos/${repository}${path}`,{...options,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});if(!r.ok)throw Error(`GitHub request failed (${r.status})`);return r.status===204?null:r.json();}
 async issue(n){return this.request(`/issues/${n}`);}
 async comments(n){const result=[];for(let page=1;page<=50;page++){const a=await this.request(`/issues/${n}/comments?per_page=100&page=${page}`);if(!Array.isArray(a))throw Error('Invalid comments');result.push(...a);if(a.length<100)return result;}throw Error('Comments limit');}
 async transition(n,from,to){const x=await this.issue(n);if(x.user?.login!==owner||x.state!=='open'||!x.title.startsWith(`[${from}]`))return false;await this.request(`/issues/${n}`,{method:'PATCH',body:JSON.stringify({title:`[${to}]${x.title.slice(from.length+2)}`})});return true;}
 async comment(n,body){await this.request(`/issues/${n}/comments`,{method:'POST',body:JSON.stringify({body})});}
 async assertNoExisting(n){for(let page=1;page<=10;page++){const a=await this.request(`/pulls?state=open&base=main&per_page=100&page=${page}`);if(!Array.isArray(a))throw Error('Invalid PR list');const issueRef=new RegExp(`(?:^|[^0-9])#${n}(?![0-9])|https://github\\.com/GUANGZECHEN/hex-island-game/issues/${n}(?![0-9])`,'i');if(a.some(p=>(typeof p.head?.ref==='string'&&(p.head.ref.startsWith(`agent/issue-${n}-`)||p.head.ref.startsWith(`codex/issue-${n}-`)))||((p.user?.type==='Bot'||p.user?.login==='github-actions[bot]')&&issueRef.test(p.body||''))))throw Error('Existing issue automation PR');if(a.length<100)return;}throw Error('PR list limit');}
}
