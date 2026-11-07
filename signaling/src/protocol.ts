export type Role = 'host' | 'guest';
export const MAX_MESSAGE = 65536;
export const MAX_RELAY_DATA = 16384;
export const MAX_CHECKPOINT_DATA = 49152;
export const ROOM_TTL_MS = 48 * 60 * 60 * 1000;

export const validToken = (s: unknown): s is string =>
  typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);

export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b))
    .replaceAll('+','-')
    .replaceAll('/','_')
    .replaceAll('=','');
}

export async function hash(s: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('');
}

export function allowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === 'https://guangzechen.github.io') return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      !!u.port &&
      u.origin === origin;
  } catch {
    return false;
  }
}

export function authorize(
  role: Role,
  suppliedHash: string,
  storedHash: string,
  expires: number,
  now: number,
  hostConnected: boolean,
  count: number,
): string | null {
  if (now >= expires) return 'expired';
  if (suppliedHash !== storedHash) return 'invalid';
  if (role === 'host' && hostConnected) return 'host-unavailable';
  if (role === 'guest' && !hostConnected) return 'host-unavailable';
  if (count >= 4) return 'room-full';
  return null;
}

export function canRoute(role: Role, target: string, guestIds: string[]): boolean {
  return role === 'guest' ? target === 'host' : guestIds.includes(target);
}

export type RoutedMessage = {
  type: 'relay';
  to: string;
  data: string;
};

export type RoomControl =
  | {type:'checkpoint-save';revision:number;round:number;replace:boolean;data:string}
  | {type:'checkpoint-list'}
  | {type:'checkpoint-load';id:string};

export function parseRoomControl(input:string):RoomControl|null {
  if(new TextEncoder().encode(input).length>MAX_MESSAGE)return null;
  let x:Record<string,unknown>;try{x=JSON.parse(input)}catch{return null}
  if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.type!=='string')return null;
  if(x.type==='checkpoint-list'&&Object.keys(x).join(',')==='type')return {type:'checkpoint-list'};
  if(x.type==='checkpoint-load'&&Object.keys(x).sort().join(',')==='id,type'&&typeof x.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x.id))return {type:'checkpoint-load',id:x.id};
  if(
    x.type==='checkpoint-save'&&
    Object.keys(x).sort().join(',')==='data,replace,revision,round,type'&&
    Number.isSafeInteger(x.revision)&&Number(x.revision)>=0&&
    Number.isSafeInteger(x.round)&&Number(x.round)>=0&&
    typeof x.replace==='boolean'&&
    typeof x.data==='string'&&
    new TextEncoder().encode(x.data).length<=MAX_CHECKPOINT_DATA
  )return {type:'checkpoint-save',revision:Number(x.revision),round:Number(x.round),replace:x.replace,data:x.data};
  return null;
}

export function parseRoutedMessage(input: string): RoutedMessage | null {
  if (new TextEncoder().encode(input).length > MAX_MESSAGE) return null;

  let x: Record<string, unknown>;
  try { x = JSON.parse(input); } catch { return null; }

  if (
    !x ||
    typeof x !== 'object' ||
    Array.isArray(x) ||
    Object.keys(x).sort().join(',') !== 'data,to,type' ||
    x.type !== 'relay' ||
    typeof x.to !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(x.to) ||
    typeof x.data !== 'string' ||
    new TextEncoder().encode(x.data).length > MAX_RELAY_DATA
  ) return null;

  return x as RoutedMessage;
}
