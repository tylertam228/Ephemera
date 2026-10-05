#!/bin/bash
set -euo pipefail

main() {
  export PATH="/opt/node20/bin:$PATH"
  cd /opt/ephemera/app
  before=$(git rev-parse HEAD)
  git fetch --quiet origin main
  git merge --ff-only origin/main
  after=$(git rev-parse HEAD)
  if [ "$before" != "$after" ] && git diff --name-only "$before" "$after" | grep -qE '(^|/)package(-lock)?\.json$'; then
    npm ci
    npm --prefix web ci
  fi
  npm --prefix web run build
  sudo /bin/systemctl restart ephemera
  sleep 2
  systemctl is-active --quiet ephemera
  echo "deployed $after"
}

main
exit
