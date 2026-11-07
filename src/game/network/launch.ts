const TOKEN=/^[A-Za-z0-9_-]{43}$/;

export type RoomLaunch =
 | {kind:'public'}
 | {kind:'creator';capability:string}
 | {kind:'invite';room:string;capability:string}
 | {kind:'invalid'};

export function parseRoomLaunch(hash:string):RoomLaunch {
 const text=hash.startsWith('#')?hash.slice(1):hash;
 if(!text)return {kind:'public'};
 const params=new URLSearchParams(text);
 const creators=params.getAll('create');
 const joins=params.getAll('join');
 if(creators.length===0&&joins.length===0)return {kind:'public'};
 if(creators.length===1&&joins.length===0&&[...params.keys()].every(key=>key==='create')&&TOKEN.test(creators[0]))return {kind:'creator',capability:creators[0]};
 if(joins.length===1&&creators.length===0&&[...params.keys()].every(key=>key==='join')){
  const parts=joins[0].split('.');
  if(parts.length===2&&parts.every(value=>TOKEN.test(value)))return {kind:'invite',room:parts[0],capability:parts[1]};
 }
 return {kind:'invalid'};
}

export function buildGuestInvite(href:string,room:string,capability:string):string {
 if(!TOKEN.test(room)||!TOKEN.test(capability))throw new Error('Invalid room invitation capability.');
 const url=new URL(href);
 url.hash=`join=${room}.${capability}`;
 return url.toString();
}
