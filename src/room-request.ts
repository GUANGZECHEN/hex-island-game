export class RoomError extends Error {}
const token = (value:unknown):value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function requestRoom(
  endpoint:string,
  creatorCapability:string,
  fetcher:typeof fetch = fetch,
):Promise<{room:string;host:string;guest:string}> {
  if(!token(creatorCapability))throw new RoomError('Private host link is invalid.');
  let response:Response;
  try {
    response=await fetcher(`${endpoint}/rooms`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${creatorCapability}`},
    });
  } catch {
    throw new RoomError('Signaling service is unreachable.');
  }
  if (!response.ok) throw new RoomError(`Room creation failed (HTTP ${response.status}).`);
  let value:unknown;
  try {value=await response.json();} catch {throw new RoomError('Room creation returned an invalid response.');}
  if (!value || typeof value !== 'object' || !('room' in value) || !('host' in value) || !('guest' in value) || !token(value.room) || !token(value.host) || !token(value.guest)) throw new RoomError('Room creation returned an invalid response.');
  return {room:value.room,host:value.host,guest:value.guest};
}
