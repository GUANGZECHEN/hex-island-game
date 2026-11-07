import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Extract only the expected production workers.dev origin from Wrangler's JSONL deployment output. */
export function deployedWorkerOrigin(output, expectedName) {
  let records;
  try { records = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { throw new Error('Invalid Wrangler structured output.'); }
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
    const mode = process.argv[3];
    if (mode !== 'temporary' && mode !== 'permanent') throw new Error('Invalid deployment mode.');
    const origin = deployedWorkerOrigin(readFileSync(process.argv[2], 'utf8'), config.name);
    if (process.argv[4] === '--extract') console.log(origin);
    else {
      if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) throw new Error('GitHub Actions output paths are unavailable.');
      appendFileSync(process.env.GITHUB_OUTPUT, `worker_origin=${origin}\n`);
      const handoff = mode === 'temporary' ? 'Temporary QA Worker: begin testing promptly; it is expected to expire after about 60 minutes. No Cloudflare setup is required.' : 'Permanent Worker: set the repository Actions variable **SIGNALING_URL** to this origin for future production builds.';
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Signaling deployment\n\nWorker origin: \`${origin}\`\n\n${handoff}\n`);
      console.log(`SIGNALING_URL=${origin}`);
    }
  } catch {
    console.error('::error::Could not determine a valid signaling Worker origin from the deployment output.');
    process.exitCode = 1;
  }
}
