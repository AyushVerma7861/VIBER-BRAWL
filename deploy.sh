#!/usr/bin/env bash
# The only sanctioned way to deploy by hand.
#
# It refuses to run unless the repo is clean and level with origin/main, because that is
# exactly how the live site drifted from GitHub before: a local `wrangler deploy` put code
# on production that was never committed, and a later deploy from main silently removed it.
#
# Normal flow: commit, push, let .github/workflows/deploy.yml do it.
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "REFUSING: working tree has uncommitted changes."
  echo "Commit and push them instead - CI will deploy."
  echo
  git status --short
  exit 1
fi

git fetch -q origin main
local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse origin/main)

if [ "$local_sha" != "$remote_sha" ]; then
  echo "REFUSING: HEAD is not origin/main."
  echo "  local : $local_sha"
  echo "  remote: $remote_sha"
  echo "Push or pull first, so the repo and the live site cannot diverge."
  exit 1
fi

echo "Repo clean and level with origin/main ($local_sha)."
echo "Deploying..."
npx --yes wrangler@4 deploy
