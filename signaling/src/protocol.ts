export type Role = 'host' | 'guest';
export const MAX_MESSAGE = 32768;
export const MAX_RELAY_DATA = 16384;

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

const validHash = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i=0;i<a.length;i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function authorizeCreator(capability: unknown, storedHash: unknown): Promise<boolean> {
  if (!validToken(capability) || !validHash(storedHash)) return false;
  return constantTimeEqual(await hash(capability), storedHash);
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
