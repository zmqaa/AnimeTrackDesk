#!/usr/bin/env bash

set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="${DEPLOY_BRANCH:-main}"
REMOTE="${DEPLOY_REMOTE:-origin}"
APP_NAME="${DEPLOY_APP_NAME:-anime-track}"
HEALTHCHECK_URL="${DEPLOY_HEALTHCHECK_URL:-http://127.0.0.1:3000/login}"

log() {
  printf '[deploy %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

run_healthcheck() {
  curl -fsS -o /dev/null --max-time 15 "$HEALTHCHECK_URL"
}

cd "$WORKSPACE_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "Current directory is not a git repository: $WORKSPACE_ROOT"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "Working tree has uncommitted changes. Commit/stash them before deploying."
fi

current_commit="$(git rev-parse HEAD)"
current_branch="$(git rev-parse --abbrev-ref HEAD)"

log "Fetching latest code from $REMOTE/$BRANCH"
git fetch "$REMOTE" "$BRANCH"

target_commit="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$current_branch" != "$BRANCH" ]]; then
  log "Switching branch from $current_branch to $BRANCH"
  git checkout "$BRANCH"
fi

if [[ "$current_commit" != "$target_commit" ]]; then
  log "Fast-forwarding to $target_commit"
  git merge --ff-only "$REMOTE/$BRANCH"
else
  log "Already at latest commit $target_commit"
fi

need_install="false"
if ! command -v npm >/dev/null 2>&1; then
  fail "npm is not available on this server"
fi

if [[ ! -d node_modules ]]; then
  need_install="true"
elif ! git diff --quiet "$current_commit" HEAD -- package.json package-lock.json; then
  need_install="true"
fi

if [[ "$need_install" == "true" ]]; then
  log "Installing dependencies with npm ci"
  npm ci
else
  log "Dependencies unchanged, skipping npm ci"
fi

log "Building production bundle"
npm run build

log "Reloading PM2 app $APP_NAME"
pm2 restart ecosystem.config.js --only "$APP_NAME" --update-env

log "Running local healthcheck: $HEALTHCHECK_URL"
run_healthcheck

log "Deployment finished successfully at commit $(git rev-parse --short HEAD)"