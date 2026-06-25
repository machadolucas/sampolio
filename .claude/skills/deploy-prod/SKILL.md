---
name: deploy-prod
description: >
  Deploy Sampolio to PRODUCTION on this machine — rebuild the prod `.next-prod`
  build in place from the current working tree and restart the live `com.sampolio.app`
  launchd service (https://sampolio.machadolucas.me, port 3999).

  INVOKE ONLY when the user EXPLICITLY asks to deploy / release / publish / ship
  Sampolio to production (e.g. "/deploy-prod", "deploy to prod", "push this live",
  "release it"). This restarts the live service that serves real financial data.

  NEVER invoke this proactively or automatically — not after edits, not after tests
  pass, not as a follow-up to other work, not because a task "seems done". It runs
  only on a direct, unambiguous production-deploy request, and even then it STOPS
  for an explicit confirmation before touching the live service.
---

# Deploy Sampolio to production

This deploys the **current working tree** of `/Users/machadolucas/sampolio` to the
live service running on this same machine: launchd agent `com.sampolio.app` runs
`next start -p 3999` against the `.next-prod/` build and the real data at
`~/.sampolio/data`. Caddy reverse-proxies `https://sampolio.machadolucas.me` → it.

There is no separate prod checkout — **deploying = rebuild `.next-prod` in place,
then restart the launchd agent** so the new build is loaded. Prod keeps serving its
old in-memory build until that restart, so all checks run *before* it.

## Two absolute rules

1. **Explicit request only.** Run this skill only when the user directly asked to
   deploy to production. Do not infer it from "the feature is done" or "tests pass".
2. **Confirm before the restart.** Build and run every gate first (none of these
   touch the running service). Then **STOP and ask the user to confirm** before the
   `launchctl` restart — the point of no return. Proceed only on an explicit "yes".

## Preconditions to check first

- You are on this machine (macOS) with the repo at `/Users/machadolucas/sampolio`.
- This is a **production** deploy from the working tree as-is. If the user has
  unfinished/experimental work in the tree they don't want live, surface that and
  confirm before continuing — `git status` (step 1) makes it visible.

## Steps

Run `node`/`pnpm` under **nvm Node 26** — the system Node 22 is first on `PATH` and
must not be used. Prefix the build pipeline with:

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 26
```

### 1. Show what's shipping
```sh
git -C /Users/machadolucas/sampolio status --short
git -C /Users/machadolucas/sampolio log -1 --oneline
```
Report the branch, last commit, and the uncommitted changes — this is exactly what
will go live (deploy tree as-is; do not commit or push).

### 2. Snapshot the production data (safety net)
Read-only on prod; takes a timestamped tarball:
```sh
tar -czf "$HOME/sampolio-data-backup-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$HOME/.sampolio" data
```
Confirm the tarball exists and report its path + size. (A daily backup already runs
at 05:10; this is extra insurance for the deploy. A code deploy does not touch data.)

### 3. Preflight + build into the prod dir
One pipeline that aborts on the first failure. `NEXT_DIST_DIR=.next-prod` is what
makes the build land in the dir prod actually serves (and keeps it isolated from the
dev preview's `.next`):
```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 26 \
  && export NEXT_DIST_DIR=.next-prod \
  && cd /Users/machadolucas/sampolio \
  && pnpm install --frozen-lockfile \
  && pnpm lint \
  && pnpm test \
  && pnpm build
```
- **Any failure here aborts the deploy** — prod stays up on its old build. Report
  what failed; do not restart.
- If `pnpm install --frozen-lockfile` fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
  (pnpm 11 supply-chain embargo) or a lockfile/`package.json` mismatch: do **not**
  force it. Regenerate the lockfile under Node 26
  (`pnpm install --lockfile-only [--config.minimumReleaseAge=0]`), re-run, and only
  then continue.
- Confirm `.next-prod/BUILD_ID` was (re)written: `ls -l /Users/machadolucas/sampolio/.next-prod/BUILD_ID`.
- The dev preview (port 4999, `next dev`) may keep running — it writes `.next`,
  prod uses `.next-prod`; they don't collide.

### 4. CONFIRMATION GATE (mandatory)
Summarize: branch/commit being shipped, that lint+tests+build passed, and the
snapshot path. Then ask the user to confirm the **production restart** using
`AskUserQuestion` (a clear yes/no). **Do not run step 5 without an explicit yes.**

### 5. Restart production
```sh
launchctl kickstart -k gui/$(id -u)/com.sampolio.app
```
If that errors or the job is parked in launchd's penalty box (repeated prior
failures), do a full reload:
```sh
launchctl bootout   gui/$(id -u)/com.sampolio.app 2>/dev/null
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.sampolio.app.plist"
```

### 6. Verify health
Do **not** use `sleep` (the Bash tool blocks foreground sleep). Poll with curl retry,
which also waits out the Next.js boot:
```sh
# Readiness (waits for the new process to come up): expect 307 (-> /auth/signin) or 200
curl -sS --retry 15 --retry-delay 1 --retry-all-errors -o /dev/null -w '%{http_code}\n' http://localhost:3999/

# Service health: 2nd column is the last exit code; 0 = healthy
launchctl list | grep com.sampolio.app

# Listening on 3999
lsof -nP -iTCP:3999 -sTCP:LISTEN

# End-to-end through Caddy: 307 is the healthy unauthenticated response
curl -skI https://sampolio.machadolucas.me/ | head -1

# Fresh startup errors
tail -n 30 "$HOME/.sampolio/logs/sampolio-error.log"
```

### 7. Report
- **Success:** state it's live and healthy, the commit/branch deployed, the HTTP
  codes seen (local + Caddy), and the snapshot path.
- **Failure:** show the `sampolio-error.log` tail and give rollback guidance — do
  **not** auto-rollback (git state is the user's call):
  ```sh
  # Revert the working tree to the last known-good state, then rebuild + restart:
  git -C /Users/machadolucas/sampolio stash        # or: git checkout <prev-commit>
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 26 \
    && NEXT_DIST_DIR=.next-prod pnpm -C /Users/machadolucas/sampolio build
  launchctl kickstart -k gui/$(id -u)/com.sampolio.app
  ```
  The step-2 snapshot is the data restore point if data ever needs it.

## Do NOT

- **Do not run `./scripts/install-launchd.sh` as part of a normal deploy.** It
  re-bakes the plist and, if `~/sampolio/.env` is ever missing, silently substitutes
  a *stale* `~/.sampolio/data/.encryption_key`, permanently orphaning all encrypted
  data. It's only for **Node-version changes** (re-baking the node path) or the
  one-time `NEXT_DIST_DIR` setup.
- **Do not write to `~/.sampolio/data`** except the read-only tar snapshot in step 2.
- **Do not build without `NEXT_DIST_DIR=.next-prod`** — that would write `.next`
  (the dev dir), and the restart would serve a stale build.
- **Do not point a dev server at port 3999 or at `~/.sampolio/data`.** Dev runs on
  4999 against `./data` (see `.claude/launch.json`).
