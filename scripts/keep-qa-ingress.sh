#!/usr/bin/env bash
set -euo pipefail

# Keep the existing process and URL through probe failures within a five-hour monitoring budget.
deadline=$(( $(date +%s) + 18000 ))
outage=false
while (( $(date +%s) < deadline )); do
  remaining=$(( deadline - $(date +%s) ))
  (( remaining > 0 )) || break
  if (( remaining < 60 )); then sleep "$remaining"; else sleep 60; fi
  (( $(date +%s) < deadline )) || break
  if ! kill -0 "$(cat "$RUNNER_TEMP/cloudflared-qa.pid")" 2>/dev/null || ! kill -0 "$(cat "$RUNNER_TEMP/wrangler-qa.pid")" 2>/dev/null; then
    echo '::warning::A temporary QA ingress process exited; monitoring cannot restore it.'
    echo 'Temporary multiplayer monitoring ended because an ingress process exited.' >> "$GITHUB_STEP_SUMMARY"
    break
  fi
  remaining=$(( deadline - $(date +%s) ))
  (( remaining > 0 )) || break
  if (( remaining < 10 )); then probe_timeout=$remaining; else probe_timeout=10; fi
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --request OPTIONS --header 'Origin: https://guangzechen.github.io' \
    --header 'Access-Control-Request-Method: POST' \
    --header 'Access-Control-Request-Headers: content-type' \
    --max-time "$probe_timeout" "$QA_SIGNALING_URL/rooms" || true)
  if [[ "$status" != 204 && "$outage" == false ]]; then
    outage=true
    echo "::warning::Temporary QA ingress probe failed (HTTP ${status:-000}); keeping the existing processes online."
    echo 'Temporary QA ingress probe failed; multiplayer access may be interrupted.' >> "$GITHUB_STEP_SUMMARY"
  elif [[ "$status" == 204 && "$outage" == true ]]; then
    outage=false
    echo 'Temporary QA ingress probe recovered.'
    echo 'Temporary QA ingress probe recovered.' >> "$GITHUB_STEP_SUMMARY"
  fi
done
