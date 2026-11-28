import { pathToFileURL } from 'node:url';

const PAGE = 'https://guangzechen.github.io/hex-island-game/';
const MAX_FILES = 30;
const MAX_BYTES = 8 * 1024 * 1024;

// Only references to same-origin JavaScript and CSS reachable from the deployed
// index are followed. All requests, redirects, file counts and sizes are bounded.
export async function discoverIngress(fetcher = fetch, page = PAGE) {
  const base = new URL(page);
  const pending = [base.href];
  const visited = new Set();
  const origins = new Set();
  let totalBytes = 0;
  while (pending.length) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    if (visited.size >= MAX_FILES) throw new Error('Too many deployed assets');
    visited.add(url);
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body) throw new Error(`Cannot fetch deployed asset: ${url}`);
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES - totalBytes)) {
      throw new Error('Deployed assets exceed size limit');
    }
    const chunks = [];
    for await (const chunk of response.body) {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BYTES) throw new Error('Deployed assets exceed size limit');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    for (const match of text.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![a-z0-9.-])/g)) origins.add(match[0]);
    // Vite's index uses src/href; compiled chunks may reference other assets
    // as quoted relative or root-relative paths. Never follow off-origin URLs.
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|["']((?:\.{1,2}\/|\/)[^"'\s]+\.(?:js|css)(?:\?[^"'\s]*)?)["']/g)) {
      let asset;
      try { asset = new URL(match[1] || match[2], url); } catch { continue; }
      if (asset.origin === base.origin && asset.pathname.startsWith(base.pathname) && /\.(?:js|css)$/.test(asset.pathname)) {
        asset.hash = '';
        pending.push(asset.href);
      }
    }
  }
  if (visited.size < 2) throw new Error('No deployed JavaScript or CSS assets found');
  if (origins.size !== 1) throw new Error(`Expected exactly one Quick Tunnel origin, found ${origins.size}`);
  return [...origins][0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await discoverIngress()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
