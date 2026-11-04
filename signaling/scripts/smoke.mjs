import { pathToFileURL } from 'node:url';

const PRODUCTION_ORIGIN = 'https://guangzechen.github.io';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KNOWN_ERRORS = new Set(['origin-denied', 'creation-failed', 'not-found', 'expired']);
class SmokeError extends Error {}

function socketReady(url, token, Socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let socket, complete = false, sentAuth = false;
    const finish = (error) => {
      if (complete) return;
      complete = true; clearTimeout(timer);
      if (socket) { try { if (socket.readyState === 1) socket.close(1000); else if (socket.readyState === 0) socket.terminate(); } catch {} }
      if (error) reject(new SmokeError('Host WebSocket connection or authentication failed.')); else resolve();
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    try {
      socket = new Socket(url, { headers: { Origin: PRODUCTION_ORIGIN }, handshakeTimeout: timeoutMs, maxPayload: 8192, perMessageDeflate: false });
      socket.on('error', () => finish(true));
      socket.on('close', () => finish(true));
      socket.on('message', (data, binary) => {
        if (complete) return;
        if (binary || data.length > 8192) return finish(true);
        let message; try { message = JSON.parse(data.toString()); } catch { return finish(true); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return finish(true);
        if (!sentAuth && message.type === 'authenticate') { sentAuth = true; try { socket.send(JSON.stringify({ type: 'auth', role: 'host', token })); } catch { finish(true); } }
        else if (sentAuth && message.type === 'ready' && message.role === 'host' && message.id === 'host') finish(false);
        else finish(true);
      });
    } catch { finish(true); }
  });
}

/** Creates a throwaway room and authenticates its host without persisting or logging capabilities. */
export async function smokeSignaling(origin, { fetchImpl = fetch, Socket, timeoutMs = 15000, now = Date.now, allowLocal = false, retries = 0, retryDelayMs = 4000, onRetry = () => {} } = {}) {
  let url; try { url = new URL(origin); } catch { throw new SmokeError('Invalid signaling origin.'); }
  const local = allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!local && (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev'))) || url.username || url.password || (url.port && !local) || url.pathname !== '/' || url.search || url.hash) throw new SmokeError('Invalid signaling origin.');
  let response;
  for (let attempt = 0; ; attempt++) {
    try { response = await fetchImpl(new URL('/rooms', url), { method: 'POST', headers: { Origin: PRODUCTION_ORIGIN, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
    catch { throw new SmokeError('Signaling service is unreachable.'); }
    if (response.status !== 404 || attempt >= retries) break;
    try { await response.body?.cancel(); } catch {}
    onRetry(); await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  let body;
  try { const text = await response.text(); if (text.length <= 8192) body = JSON.parse(text); } catch {}
  if (response.status !== 201) {
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 'unknown';
    const code = body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && KNOWN_ERRORS.has(body.error) ? `, ${body.error}` : '';
    throw new SmokeError(`Room creation failed (HTTP ${status}${code}).`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.room !== 'string' || !TOKEN.test(body.room) || typeof body.host !== 'string' || !TOKEN.test(body.host) || typeof body.guest !== 'string' || !TOKEN.test(body.guest) || !Number.isSafeInteger(body.expires) || body.expires <= now()) throw new SmokeError('Room creation returned an invalid response.');
  if (!Socket) { try { Socket = (await import('ws')).default; } catch { throw new SmokeError('Host WebSocket connection or authentication failed.'); } }
  const ws = new URL(`/rooms/${body.room}/socket`, url); ws.protocol = local ? 'ws:' : 'wss:';
  await socketReady(ws.toString(), body.host, Socket, timeoutMs);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await smokeSignaling(process.argv[2], { retries: 7, onRetry: () => console.log('Signaling smoke: HTTP 404; retrying.') }); console.log('Signaling smoke passed: HTTP 201 and host WebSocket ready.'); }
  catch (error) { console.error(`::error::${error instanceof SmokeError ? error.message : 'Signaling smoke failed.'}`); process.exitCode = 1; }
}
