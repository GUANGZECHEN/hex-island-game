#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

case "${DEPLOYMENT_MODE:-}" in
  temporary)
    if [[ -n "${CLOUDFLARE_API_TOKEN:-}" || -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
      echo '::error::Temporary mode requires both Cloudflare credentials to be absent.'
      exit 1
    fi
    ;;
  permanent)
    if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
      echo '::error::Permanent mode requires both Cloudflare credentials.'
      exit 1
    fi
    ;;
  *) echo '::error::Invalid signaling deployment mode.'; exit 1 ;;
esac

# Wrangler prefers this legacy directory over XDG_CONFIG_HOME when it exists.
if [[ -d "$HOME/.wrangler" ]]; then
  echo '::error::Cannot isolate Wrangler credentials on this runner.'
  exit 1
fi
temporary_dir=$(mktemp -d "$RUNNER_TEMP/hex-signaling.XXXXXXXX")
trap 'rm -rf -- "$temporary_dir"' EXIT
export XDG_CONFIG_HOME="$temporary_dir/config"
export XDG_CACHE_HOME="$temporary_dir/cache"
export npm_config_cache="$temporary_dir/npm-cache"
export WRANGLER_OUTPUT_FILE_PATH="$temporary_dir/deployment.jsonl"
creator_capability=''
creator_hash=''
if [[ "$DEPLOYMENT_MODE" == temporary ]]; then
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  IFS=
    echo '::error::Temporary signaling deployment failed; sensitive Wrangler output was suppressed.'
    exit 1
  fi
else
  if ! npm exec -- wrangler deploy --config wrangler.jsonc >"$temporary_dir/wrangler.log" 2>&1; then
    echo '::error::Permanent signaling deployment failed; sensitive Wrangler output was suppressed.'
    exit 1
  fi
fi
worker_origin=$(node ../scripts/signaling-deploy-origin.mjs "$WRANGLER_OUTPUT_FILE_PATH" "$DEPLOYMENT_MODE" --extract)

if [[ "$DEPLOYMENT_MODE" == temporary ]]; then
  smoke_ok=0
  for smoke_attempt in 1 2 3; do
    if CREATOR_CAPABILITY="$creator_capability" node scripts/smoke.mjs "$worker_origin" >"$temporary_dir/smoke.log" 2>&1; then
      cat "$temporary_dir/smoke.log"
      smoke_ok=1
      break
    fi
    if [[ "$smoke_attempt" -lt 3 ]]; then
      sleep 5
    fi
  done
  if [[ "$smoke_ok" -ne 1 ]]; then
    cat "$temporary_dir/smoke.log"
    exit 1
  fi
else
  echo 'Permanent signaling deployment completed. Creator-protected room creation must be verified with the owner capability after deployment.'
fi

node ../scripts/signaling-deploy-origin.mjs "$WRANGLER_OUTPUT_FILE_PATH" "$DEPLOYMENT_MODE"
\t' read -r creator_capability creator_hash < <(node ../scripts/creator-capability.mjs --machine)
  if ! npm exec -- wrangler deploy --temporary --config wrangler.jsonc --var "CREATOR_CAPABILITY_HASH:$creator_hash" >"$temporary_dir/wrangler.log" 2>&1; then
    echo '::error::Temporary signaling deployment failed; sensitive Wrangler output was suppressed.'
    exit 1
  fi
else
  if ! npm exec -- wrangler deploy --config wrangler.jsonc >"$temporary_dir/wrangler.log" 2>&1; then
    echo '::error::Permanent signaling deployment failed; sensitive Wrangler output was suppressed.'
    exit 1
  fi
fi
worker_origin=$(node ../scripts/signaling-deploy-origin.mjs "$WRANGLER_OUTPUT_FILE_PATH" "$DEPLOYMENT_MODE" --extract)

smoke_ok=0
for smoke_attempt in 1 2 3; do
  if node scripts/smoke.mjs "$worker_origin" >"$temporary_dir/smoke.log" 2>&1; then
    cat "$temporary_dir/smoke.log"
    smoke_ok=1
    break
  fi
  if [[ "$smoke_attempt" -lt 3 ]]; then
    sleep 5
  fi
done
if [[ "$smoke_ok" -ne 1 ]]; then
  cat "$temporary_dir/smoke.log"
  exit 1
fi

node ../scripts/signaling-deploy-origin.mjs "$WRANGLER_OUTPUT_FILE_PATH" "$DEPLOYMENT_MODE"
