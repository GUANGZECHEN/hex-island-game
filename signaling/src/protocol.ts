export type Role = 'host' | 'guest';
export const MAX_MESSAGE = 32768;
export const validToken = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
export function randomToken(): string { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
export async function hash(s: string): Promise<string> { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join(''); }
export function allowedOrigin(origin: string | null): boolean { if (!origin) return false; if (origin === 'https://guangzechen.github.io') return true; try { const u = new URL(origin); return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && !!u.port && u.origin === origin; } catch { return false; } }
export function authorize(role: Role, suppliedHash: string, storedHash: string, expires: number, now: number, hostConnected: boolean, count: number): string | null { if (now >= expires) return 'expired'; if (suppliedHash !== storedHash) return 'invalid'; if (role === 'host' && hostConnected) return 'host-unavailable'; if (role === 'guest' && !hostConnected) return 'host-unavailable'; if (count >= 4) return 'room-full'; return null; }
export function canRoute(role: Role, target: string, guestIds: string[]): boolean { return role === 'guest' ? target === 'host' : guestIds.includes(target); }
export type Signal = { type: 'offer' | 'answer' | 'candidate'; to: string; data: unknown };
export function parseSignal(input: string, role: Role): Signal | null {
 if (new TextEncoder().encode(input).length > MAX_MESSAGE) return null;
 let x: Record<string, unknown>; try { x = JSON.parse(input); } catch { return null; }
 if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).sort().join(',') !== 'data,to,type' || typeof x.to !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(x.to)) return null;
 if (x.type === 'offer' || x.type === 'answer') { if ((role === 'host') !== (x.type === 'offer') || typeof x.data !== 'string' || !x.data || x.data.length > 24000) return null; }
 else if (x.type === 'candidate') { if (x.data !== null) { if (typeof x.data !== 'object' || Array.isArray(x.data)) return null; const c = x.data as Record<string,unknown>; if (Object.keys(c).some(k => !['candidate','sdpMid','sdpMLineIndex','usernameFragment'].includes(k)) || typeof c.candidate !== 'string' || (c.sdpMid != null && typeof c.sdpMid !== 'string') || (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || (c.sdpMLineIndex as number) < 0)) || (c.usernameFragment != null && typeof c.usernameFragment !== 'string') || JSON.stringify(c).length > 4096) return null; } }
 else return null;
 return x as Signal;
}
