export class RoomError extends Error {}
const token = (value:unknown):value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export async function requestRoom(endpoint:string, fetcher:typeof fetch = fetch, signal?:AbortSignal):Promise<{room:string;host:string;guest:string}> {
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>,cancel:()=>void=()=>{};
  const timeout=new Promise<never>((_,reject)=>{
    cancel=()=>{controller.abort();reject(new RoomError('Signaling service is unreachable.'));};
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(cancel,15000);
  });
  let value:unknown;
  try {
    const request=async()=>{
      let response:Response;
      try { response=await fetcher(`${endpoint}/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal}); }
      catch { throw new RoomError('Signaling service is unreachable.'); }
      if (!response.ok) throw new RoomError(`Room creation failed (HTTP ${response.status}).`);
      try {return await response.json();} catch {throw new RoomError('Room creation returned an invalid response.');}
    };
    value=await Promise.race([request(),timeout]);
  } finally {clearTimeout(timer!);signal?.removeEventListener('abort',cancel);}
  if (!value || typeof value !== 'object' || !('room' in value) || !('host' in value) || !('guest' in value) || !token(value.room) || !token(value.host) || !token(value.guest)) throw new RoomError('Room creation returned an invalid response.');
  return {room:value.room,host:value.host,guest:value.guest};
}
