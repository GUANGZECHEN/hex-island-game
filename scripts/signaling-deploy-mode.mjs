import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function selectDeploymentMode(token, accountId) {
  if (token && accountId) return 'permanent';
  if (!token && !accountId) return 'temporary';
  throw new Error('Provide both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or neither for temporary QA.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = selectDeploymentMode(process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID);
    if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub Actions output path is unavailable.');
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
    console.log(`Signaling deployment mode: ${mode}`);
  } catch {
    console.error('::error::Set both Cloudflare credentials, or neither for temporary QA.');
    process.exitCode = 1;
  }
}
