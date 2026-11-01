import { routeTask } from '../../src/orchestration/model-routing.ts';
export const owner='GUANGZECHEN';
export const repository='GUANGZECHEN/hex-island-game';
export function eligible(event,repo) {
 const issue=event?.issue;
 return repo===repository && event?.sender?.login===owner && issue?.user?.login===owner && !issue.pull_request && issue.state==='open' && typeof issue.title==='string' && issue.title.startsWith('[READY]') && ['opened','reopened','edited'].includes(event.action) && (event.action!=='edited' || (typeof event.changes?.title?.from==='string' && !event.changes.title.from.startsWith('[READY]')));
}
export function liveEligible(issue) {return !!issue && !issue.pull_request && issue.user?.login===owner && issue.state==='open' && typeof issue.title==='string' && issue.title.startsWith('[READY]');}
export function parseComplexity(body) {
 if(typeof body!=='string')return undefined;
 const matches=[...body.matchAll(/^\s*complexity\s*:\s*([^\r\n#]*?)(?:\s*#.*)?\s*$/gim)];
 if(matches.length!==1)return undefined;
 const value=matches[0][1].trim();return ['simple','complex','decision'].includes(value)?value:undefined;
}
export function specification(issue,comments) {
 if(issue?.user?.login!==owner || typeof issue.body!=='string')throw Error('Untrusted issue');
 if(!Array.isArray(comments))throw Error('Invalid comments');
 const filtered=comments.filter(x=>x?.user?.login===owner && typeof x.body==='string').map(x=>x.body);
 return {body:issue.body,comments:filtered};
}
export function routeIssue(issue) {return routeTask({complexity:parseComplexity(issue?.body)});}
