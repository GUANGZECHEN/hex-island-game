import { pathToFileURL } from 'node:url';

const PRODUCTION_ORIGIN = 'https://guangzechen.github.io';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KNOWN_ERRORS = new Set(['origin-denied', 'creation-failed', 'not-found', 'expired']);
class SmokeError extends Error {}

function parseSocketMessage(data, binary) {
  if (binary || data.length > 32768) return null;
  try {
    const value = JSON.parse(data.toString());
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function connectSocket(url, token, role, Socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let socket;
    let sentAuth = false;
    let complete = false;

    const cleanup = () => {
      if (!socket) return;
      socket.off?.('message', onMessage);
      socket.off?.('error', onError);
      socket.off?.('close', onClose);
    };
    const finish = (error) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      cleanup();
      if (error) {
        try {
          if (socket?.readyState === 1) socket.close(1000);
          else if (socket?.readyState === 0) socket.terminate();
        } catch {}
        reject(new SmokeError('Room WebSocket connection or authentication failed.'));
      } else {
        resolve(socket);
      }
    };
    const onError = () => finish(true);
    const onClose = () => finish(true);
    const onMessage = (data, binary) => {
      if (complete) return;
      const message = parseSocketMessage(data,binary);
      if (!message) return finish(true);
      if (!sentAuth && message.type === 'authenticate') {
        sentAuth = true;
        try { socket.send(JSON.stringify({type:'auth',role,token})); } catch { finish(true); }
        return;
      }
      if (
        sentAuth &&
        message.type === 'ready' &&
        message.role === role &&
        ((role === 'host' && message.id === 'host') || (role === 'guest' && TOKEN.test(message.id)))
      ) {
        finish(false);
        return;
      }
      finish(true);
    };

    const timer=setTimeout(()=>finish(true),timeoutMs);
    try {
      socket=new Socket(url,{
        headers:{Origin:PRODUCTION_ORIGIN},
        handshakeTimeout:timeoutMs,
        maxPayload:32768,
        perMessageDeflate:false,
      });
      socket.on('message',onMessage);
      socket.on('error',onError);
      socket.on('close',onClose);
    } catch {
      finish(true);
    }
  });
}

function waitMessage(socket, predicate, timeoutMs) {
  return new Promise((resolve,reject)=>{
    let complete=false;
    const cleanup=()=>{
      clearTimeout(timer);
      socket.off?.('message',onMessage);
      socket.off?.('error',onError);
      socket.off?.('close',onClose);
    };
    const finish=(error,value)=>{
      if(complete)return;
      complete=true;
      cleanup();
      if(error)reject(new SmokeError('Room WebSocket relay failed.'));
      else resolve(value);
    };
    const onError=()=>finish(true);
    const onClose=()=>finish(true);
    const onMessage=(data,binary)=>{
      const message=parseSocketMessage(data,binary);
      if(!message)return finish(true);
      if(predicate(message))finish(false,message);
    };
    const timer=setTimeout(()=>finish(true),timeoutMs);
    socket.on('message',onMessage);
    socket.on('error',onError);
    socket.on('close',onClose);
  });
}

/** Creates a throwaway room, authenticates host+guest and verifies bidirectional relay. */
export async function smokeSignaling(origin, {
  fetchImpl = fetch,
  Socket,
  timeoutMs = 15000,
  now = Date.now,
  allowLocal = false,
  retries = 0,
  retryDelayMs = 4000,
  onRetry = () => {},
  creatorCapability = process.env.CREATOR_CAPABILITY ?? '',
} = {}) {
  let url;
  try { url = new URL(origin); } catch { throw new SmokeError('Invalid signaling origin.'); }

  const local = allowLocal && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname);
  const workersDev = url.protocol === 'https:' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/.test(url.hostname);
  const quickTunnel = url.protocol === 'https:' && /^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname);
  if (
    (!local && !workersDev && !quickTunnel) ||
    url.username ||
    url.password ||
    (url.port && !local) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) throw new SmokeError('Invalid signaling origin.');

  if(!TOKEN.test(creatorCapability))throw new SmokeError('Creator capability is unavailable.');

  let response;
  for (let attempt=0;;attempt++) {
    try {
      response=await fetchImpl(new URL('/rooms',url),{
        method:'POST',
        headers:{Origin:PRODUCTION_ORIGIN,'Content-Type':'application/json','Authorization':`Bearer ${creatorCapability}`},
        signal:AbortSignal.timeout(timeoutMs),
        redirect:'error',
      });
    } catch {
      if(attempt>=retries)throw new SmokeError('Signaling service is unreachable.');
      onRetry();
      await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
      continue;
    }

    if(response.status!==404 || attempt>=retries)break;
    try{await response.body?.cancel();}catch{}
    onRetry();
    await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
  }

  let body;
  try {
    const text=await response.text();
    if(text.length<=8192)body=JSON.parse(text);
  } catch {}

  if(response.status!==201){
    const status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:'unknown';
    const code=body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&KNOWN_ERRORS.has(body.error)?`, ${body.error}`:'';
    throw new SmokeError(`Room creation failed (HTTP ${status}${code}).`);
  }

  if (
    !body ||
    typeof body!=='object' ||
    Array.isArray(body) ||
    typeof body.room!=='string' || !TOKEN.test(body.room) ||
    typeof body.host!=='string' || !TOKEN.test(body.host) ||
    typeof body.guest!=='string' || !TOKEN.test(body.guest) ||
    !Number.isSafeInteger(body.expires) ||
    body.expires<=now()
  ) throw new SmokeError('Room creation returned an invalid response.');

  if(response.headers.get('access-control-allow-origin')!==PRODUCTION_ORIGIN) {
    throw new SmokeError('Signaling CORS response failed.');
  }

  let preflight;
  try {
    preflight=await fetchImpl(new URL('/rooms',url),{
      method:'OPTIONS',
      headers:{
        Origin:PRODUCTION_ORIGIN,
        'Access-Control-Request-Method':'POST',
        'Access-Control-Request-Headers':'authorization,content-type',
      },
      signal:AbortSignal.timeout(timeoutMs),
      redirect:'error',
    });
  } catch {
    throw new SmokeError('Signaling CORS preflight failed.');
  }

  const methods=(preflight.headers.get('access-control-allow-methods')??'').toUpperCase().split(',').map(value=>value.trim());
  const headers=(preflight.headers.get('access-control-allow-headers')??'').toLowerCase().split(',').map(value=>value.trim());
  if (
    preflight.status!==204 ||
    preflight.headers.get('access-control-allow-origin')!==PRODUCTION_ORIGIN ||
    !methods.includes('POST') ||
    !headers.includes('content-type') ||
    !headers.includes('authorization')
  ) throw new SmokeError('Signaling CORS preflight failed.');

  if(!Socket){
    try{Socket=(await import('ws')).default;}
    catch{throw new SmokeError('Room WebSocket connection or authentication failed.');}
  }

  const wsUrl=new URL(`/rooms/${body.room}/socket`,url);
  wsUrl.protocol=local?'ws:':'wss:';

  let hostSocket,guestSocket;
  try{
    hostSocket=await connectSocket(wsUrl.toString(),body.host,'host',Socket,timeoutMs);
    const joinPromise=waitMessage(hostSocket,m=>m.type==='join'&&TOKEN.test(m.id),timeoutMs);
    guestSocket=await connectSocket(wsUrl.toString(),body.guest,'guest',Socket,timeoutMs);
    const join=await joinPromise;
    const guestId=join.id;

    const guestToHost=waitMessage(
      hostSocket,
      m=>m.type==='relay'&&m.from===guestId&&m.data==='relay-smoke-guest',
      timeoutMs,
    );
    guestSocket.send(JSON.stringify({type:'relay',to:'host',data:'relay-smoke-guest'}));
    await guestToHost;

    const hostToGuest=waitMessage(
      guestSocket,
      m=>m.type==='relay'&&m.from==='host'&&m.data==='relay-smoke-host',
      timeoutMs,
    );
    hostSocket.send(JSON.stringify({type:'relay',to:guestId,data:'relay-smoke-host'}));
    await hostToGuest;
  } finally {
    for(const socket of [guestSocket,hostSocket]){
      try{if(socket?.readyState===1)socket.close(1000);else if(socket?.readyState===0)socket.terminate();}catch{}
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await smokeSignaling(process.argv[2],{
      retries:10,
      retryDelayMs:3000,
      onRetry:()=>console.log('Signaling smoke: endpoint not ready; retrying.'),
    });
    console.log('Signaling smoke passed: HTTP 201, CORS, host+guest WebSockets and bidirectional relay ready.');
  } catch(error) {
    console.error(`::error::${error instanceof SmokeError?error.message:'Signaling smoke failed.'}`);
    process.exitCode=1;
  }
}
