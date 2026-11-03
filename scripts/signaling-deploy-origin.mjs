import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Extract only the expected production workers.dev origin from Wrangler's JSONL deployment output. */
export function deployedWorkerOrigin(output, expectedName) {
  const records = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const deployment = records.filter(record => record.type === 'deploy' && record.version === 1 && record.worker_name === expectedName).at(-1);
  if (!deployment || typeof deployment.version_id !== 'string' || !deployment.version_id || !Array.isArray(deployment.targets)) throw new Error('Wrangler did not report a successful deployment and its targets.');
  const origins = new Set();
  for (const target of deployment.targets) {
    if (typeof target !== 'string') continue;
    let url; try { url = new URL(target); } catch { continue; }
    const prefix = `${expectedName}.`, suffix = '.workers.dev';
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !url.hostname.startsWith(prefix) || !url.hostname.endsWith(suffix)) continue;
    const subdomain = url.hostname.slice(prefix.length, -suffix.length);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) continue;
    origins.add(url.origin);
  }
  if (origins.size !== 1) throw new Error('Expected one production workers.dev origin; check that the account subdomain and workers_dev are enabled.');
  return [...origins][0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const origin = deployedWorkerOrigin(readFileSync(process.argv[2], 'utf8'), config.name);
    if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) throw new Error('GitHub Actions output paths are unavailable.');
    appendFileSync(process.env.GITHUB_OUTPUT, `worker_origin=${origin}\n`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Signaling deployment\n\nWorker origin: \`${origin}\`\n\nSet the repository Actions variable **SIGNALING_URL** to this origin, then rerun **Deploy PoC to GitHub Pages** on the QA branch.\n`);
    console.log(`SIGNALING_URL=${origin}`);
  } catch (error) {
    console.error(`Could not determine the deployed Worker origin: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}
