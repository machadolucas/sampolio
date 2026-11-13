#!/bin/bash
#
# launchd wrapper for the system-domain Sampolio daemon
# (/Library/LaunchDaemons/com.sampolio.app.plist, UserName = the app user).
#
# The system plist is root-owned and carries no secrets. The environment the app
# needs (ENCRYPTION_KEY, AUTH_SECRET, AUTH_URL, the Enable Banking settings,
# HA_WEBHOOK_URL, DATA_DIR, NEXT_DIST_DIR, PORT, HOSTNAME, …) lives in an env
# file owned by the app user, mode 0600 — by default ~/.sampolio/launchd.env,
# written by `SAMPOLIO_LAUNCHD_DOMAIN=system ./scripts/install-launchd.sh`.
#
# The plist sets SAMPOLIO_NODE (the node binary resolved from .nvmrc at install
# time) and optionally SAMPOLIO_ENV_FILE. This script refuses to start unless the
# env file is a regular file owned by the current uid with mode 600, then execs
# `next start` so node becomes the launchd-tracked process (kill-by-pid restarts
# work because the plist has KeepAlive).
#
# Exit 78 (EX_CONFIG) = a configuration problem; the reason is on stderr, which
# launchd writes to ~/.sampolio/logs/sampolio-error.log. Never echoes secrets.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_OVERRIDE="${SAMPOLIO_REPO_ROOT:-}"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(dirname "$SCRIPT_DIR")}"
ENV_FILE="${SAMPOLIO_ENV_FILE:-$HOME/.sampolio/launchd.env}"
DEPLOY_HOLD_OVERRIDE="${SAMPOLIO_DEPLOY_HOLD_FILE:-}"

fatal() { echo "launchd-run: FATAL: $*" >&2; exit 78; }

[ -n "${HOME:-}" ] || fatal "HOME is not set (the plist must set HOME)"
[ -e "$ENV_FILE" ] || fatal "missing env file $ENV_FILE (run SAMPOLIO_LAUNCHD_DOMAIN=system ./scripts/install-launchd.sh)"
[ ! -L "$ENV_FILE" ] || fatal "$ENV_FILE must not be a symlink"
[ -f "$ENV_FILE" ] || fatal "$ENV_FILE is not a regular file"
read -r env_uid env_mode < <(stat -f '%u %Lp' "$ENV_FILE")
[ "$env_uid" = "$(id -u)" ] || fatal "$ENV_FILE must be owned by uid $(id -u) (is uid $env_uid)"
[ "$env_mode" = "600" ] || fatal "$ENV_FILE must be mode 600 (is $env_mode)"

# bash sets HOSTNAME to the machine name when it is not in the environment;
# drop it so only the env file can choose the bind address.
unset HOSTNAME
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

for v in ENCRYPTION_KEY AUTH_SECRET AUTH_URL DATA_DIR; do
    [ -n "${!v:-}" ] || fatal "$v is not set in $ENV_FILE"
done

NODE="${SAMPOLIO_NODE:-}"
[ -n "$NODE" ] || fatal "SAMPOLIO_NODE is not set (the plist bakes the node path)"
[ -x "$NODE" ] || fatal "node not executable at $NODE (re-run install-launchd.sh after a Node change)"

export NODE_ENV="${NODE_ENV:-production}"
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-prod}"
export PORT="${PORT:-3999}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"

# Deployment can hold the loaded KeepAlive daemon while matching dependencies
# and build artifacts are promoted. The default path is fixed under ~/.sampolio
# so it does not depend on the app's data directory or change with env files.
DEPLOY_HOLD_FILE="${DEPLOY_HOLD_OVERRIDE:-$HOME/.sampolio/run/deploy-hold}"
[ ! -L "$DEPLOY_HOLD_FILE" ] || fatal "deploy hold path must not be a symlink"
while [ -e "$DEPLOY_HOLD_FILE" ]; do
    sleep 2
done

cd "$REPO_ROOT"
[ -f "node_modules/next/dist/bin/next" ] || fatal "Next.js is not installed in $REPO_ROOT (run ./scripts/server-deploy.sh)"
[ -f "$NEXT_DIST_DIR/BUILD_ID" ] || fatal "no production build ($NEXT_DIST_DIR/BUILD_ID missing; run ./scripts/server-deploy.sh)"

exec "$NODE" "$REPO_ROOT/node_modules/next/dist/bin/next" start -p "$PORT" -H "$HOSTNAME"
