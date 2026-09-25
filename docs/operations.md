# Sampolio — Operations (Infrastructure, Deploy, Backups, Secrets)

How the maintainer's production instance is deployed, exposed, backed up, and
configured. This is a **self-hosted, single-machine** setup: one macOS host runs
the app, serves it on the LAN through Caddy, and exposes it to the internet
through a Cloudflare Tunnel gated by Cloudflare Access (Zero Trust).

> **Public repo note:** this file deliberately contains **no secrets, account
> IDs, identity-provider IDs, tunnel UUIDs, or personal emails**. Those live only
> in the host's env file, the 0600 key file, and the Cloudflare dashboard.
> Placeholders like `<your-domain>` / `<team>` / `the allow-listed emails` stand
> in for account-specific values. Replace them if you reproduce this setup.

## Topology

```
                         ┌─────────────────────────── the internet ───────────────────────────┐
                         │                                                                      │
  Browser (cellular) ──▶ Cloudflare edge ──▶ Cloudflare Access (Zero Trust login gate)          │
                         │                        │  allow: the household emails                │
                         │                        ▼                                             │
                         │                   cloudflared "home" tunnel (outbound from the host) │
                         │                        │                                             │
  Browser (home LAN) ──▶ split-horizon DNS ──▶ Caddy (LAN, :443)  ──────────┐                   │
                                                                            ▼                   ▼
                                                            next start -p 3999  (launchd: com.sampolio.app)
                                                                            │  serves .next-prod
                                                                            ▼
                                                            ~/.sampolio/data  (encrypted JSON, AES-256-GCM
                                                                               + SQLCipher sampolio.db for auth)
```

- **From the LAN**, split-horizon DNS resolves `<your-domain>` to the Caddy host,
  so home traffic never leaves the network and never hits Cloudflare Access.
- **From the internet**, public DNS is a Cloudflare-proxied record; traffic enters
  the Cloudflare edge, is gated by Access, and is delivered to the host over the
  tunnel. There is **no inbound port forwarding** — the tunnel is outbound-only.

## 1. Application runtime (launchd)

- **Service:** launchd agent `com.sampolio.app`
  (`~/Library/LaunchAgents/com.sampolio.app.plist`, `KeepAlive` → auto-restarts on
  crash, starts at login).
- **Command:** `next start -p 3999 -H 127.0.0.1` with **`NEXT_DIST_DIR=.next-prod`**
  so prod serves its own build dir, isolated from the dev preview's `.next`. The
  app binds **loopback only** (`SAMPOLIO_HOST`, default `127.0.0.1`, in
  `scripts/install-launchd.sh` / `run-sampolio.sh`): its only clients are Caddy and
  cloudflared on the same host, so LAN devices cannot bypass the proxy.
- **Working copy:** there is **one** git clone at `~/sampolio`. Deploying =
  rebuild `.next-prod` in place + restart the agent (no separate prod checkout).
- **Data:** `~/.sampolio/data` (per-user encrypted `.enc` files, plus the
  SQLCipher `sampolio.db` holding users/sessions/passkeys and its verified
  snapshot `snapshots/sampolio.db`; see the DB layer docs). The app reads its
  secrets from the environment, not from disk.
- **Boot log lines** (`sampolio.log`, from `src/lib/db/sqlite/bootstrap.ts`):
  `[db] opened encrypted database … (migrations applied)`; on the first 4.x boot
  `[db] imported N legacy users (M soft-deleted) from .enc files`, afterwards
  `[db] legacy users already imported`; then, from `src/lib/db/sqlite/maintenance.ts`,
  `[db] pruned N expired verification row(s) (startup)` and
  `[db] pruned N stale rate-limit row(s) (startup)` (the same lines with `(hourly)`
  whenever an hourly prune deletes something); then `[db] snapshot (startup) written …
  (encrypted, verified)`. On failure `sampolio-error.log` gets a `====` banner
  starting `[db] STARTUP FAILED — sign-in and sign-up are DISABLED` plus the cause.
- **Fail-closed boot.** The legacy import aborts (one transaction, marker never
  written) on: an unreadable/corrupt `users-index.enc` or `user.enc` (usually a
  wrong `ENCRYPTION_KEY`), `users/*` dirs without `users-index.enc`, an index
  entry without its dir, a `user.enc` whose id differs from its dir, an indexed
  user without email, duplicate emails, or an email already owned by another DB
  row. The app keeps serving pages, but sign-up and every session creation
  (password, passkey, dev bypass) are refused, `auth()` returns null and
  `/api/auth/*` answers **503 `SETUP_INCOMPLETE`**. The same gate applies without
  the in-process flag whenever `.enc` user data exists but the `_meta` import
  marker is missing. If this boot had just **created** `sampolio.db` (first boot)
  it is closed and deleted, so a DB keyed with a wrong key never survives to a
  later "working" boot; a pre-existing DB is never deleted (and is still
  snapshotted). Fix the key/files, then restart (`launchctl kickstart -k …`).
- **First-user rule** (sign-up bypasses the self-signup setting and becomes
  admin) applies only to a truly fresh install: setup complete, no user rows at
  all (soft-deleted included) and no `users-index.enc` / `users/*` on disk.
- **Logs:** `~/.sampolio/logs/sampolio.log` and `sampolio-error.log`.
- **Env:** baked into the plist from `~/sampolio/.env` by
  `scripts/install-launchd.sh` (see §5). The plist embeds the resolved Node path
  (from `.nvmrc`) so boot doesn't depend on an interactive shell.

The Node version is pinned in `.nvmrc`; run prod tooling under that version (nvm).

## 2. Reverse proxy + DNS

- **Caddy** (on the LAN host) terminates TLS and reverse-proxies
  `https://<your-domain>` → `http://127.0.0.1:3999` (loopback — the app is not
  reachable on the LAN address). Caddy strips any client-sent `Cf-Connecting-Ip`
  (`header_up -Cf-Connecting-Ip`), because Better Auth and the sign-up limiter
  key rate limits on it first (`src/lib/auth/server.ts`, `src/lib/rate-limit.ts`).
- **Split-horizon DNS:** the LAN resolver points `<your-domain>` at the internal
  Caddy host; public DNS points it at Cloudflare (proxied). Same URL works at home
  (direct → Caddy) and away (→ Cloudflare Access → tunnel), which is why a login
  gate only ever appears from the internet.

## 3. Public exposure — Cloudflare Tunnel

- A single **cloudflared tunnel named `home`** serves several hostnames; Sampolio
  reuses it (one tunnel can serve many hostnames — no need for a per-app tunnel).
- Config: `~/.cloudflared/config.yml`. The Sampolio ingress rule maps
  `<your-domain>` → `http://localhost:3999` (resolves to `::1` first, which is
  refused, then `127.0.0.1`). Other hostnames on the same tunnel
  (e.g. Home Assistant, photos) are **not** gated by Access — gating is per-app
  in Cloudflare, see §4.

## 4. Access control — Cloudflare Access (Zero Trust)

The whole app is internet-reachable but **gated at the Cloudflare edge** by Access.
Auth happens before any request reaches the tunnel/host, in addition to the app's
own Better Auth login (password or passkey).

Two Access applications cover the one hostname:

| Application | Scope | Policy | Why |
|---|---|---|---|
| **Sampolio** | `<your-domain>` (whole app) | `allow` — the household's email addresses only | Gate the app to a small allow-list |
| **Sampolio bank callback (bypass)** | `<your-domain>/api/bank/callback` | `bypass` — everyone | The bank's PSD2/SCA consent redirect must land without an Access login. Still protected by the app session + a single-use CSRF `state` |

**Identity provider (login method):** **One-time PIN** (email code). The visitor
enters their email, Cloudflare emails a 6-digit code; the `allow` policy means
only the allow-listed addresses can complete login. No external IdP setup is
required, and OTP works for any email domain (iCloud, Gmail, …).

> A Zero Trust account with **no identity provider** shows *"There are no login
> methods available for this account"* on the login screen — that is the symptom
> of a missing IdP, not a code bug. Creating the One-time PIN IdP fixes it.

**Optional — Google login:** can be added as a second login method for one-click
sign-in, but it requires a Google OAuth client (client_id + secret) created in
Google Cloud Console and entered in the Zero Trust dashboard
(*Settings → Authentication → Login methods → Add → Google*). One-time PIN already
covers every allow-listed email, so Google is convenience only.

**Session length:** the Sampolio app's **session duration is `730h` (≈1 month)**
— Cloudflare's maximum. After one PIN login, a device's `CF_Authorization`
cookie stays valid for ~1 month before re-verifying. The cookie is per-browser and
server-set (so it isn't subject to Safari's 7-day script-cookie cap). A lost
device keeps access until expiry → revoke sessions if needed (§6).

## 5. Enable Banking secrets (bank sync)

Bank sync (read-only PSD2 AIS) hard-disables itself unless all three env vars are
present, so these are the only secrets the feature needs:

| Variable | What | Where |
|---|---|---|
| `ENABLE_BANKING_APP_ID` | Enable Banking application id (JWT `kid`) | `~/sampolio/.env` |
| `ENABLE_BANKING_REDIRECT_URL` | `https://<your-domain>/api/bank/callback` | `~/sampolio/.env` |
| `ENABLE_BANKING_PRIVATE_KEY_FILE` | Path to the RS256 **PKCS#8 PEM** | `~/.sampolio/enable_banking_private_key.pem` (chmod `0600`, **outside** the repo) |

These are baked into the launchd plist by `scripts/install-launchd.sh`. The app is
**production** (no `ENABLE_BANKING_BASE_URL` override). See
[`docs/bank-sync.md`](bank-sync.md) and the "Bank Sync" section of
[`AGENTS.md`](../AGENTS.md) for the feature itself.

## 6. Operations runbook

**Deploy** — snapshot the data dir first, then run `pnpm install --frozen-lockfile`
/ `lint` / `test` and build into `.next-prod`. Restart and health-check only once
every gate passes; never restart if any of them fails. `server-deploy.sh` (§7) is
the scripted form of this sequence.

- **Code-only deploy:** `launchctl kickstart -k gui/$(id -u)/com.sampolio.app`.
- **After changing plist env vars** (e.g. adding `ENABLE_BANKING_*` or
  `HA_WEBHOOK_URL` — see §9): `kickstart` reuses the loaded job and does **not**
  re-read the plist — do a **full reload** once:
  `launchctl bootout gui/$(id -u)/com.sampolio.app` then
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sampolio.app.plist`.
  Until that reload the new variable is absent, so the feature it gates (bank
  sync, split notifications) stays hard-disabled and silently does nothing.
- **Health checks:** `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/`
  (expect `307`); `lsof -nP -iTCP:3999 -sTCP:LISTEN` (expect `127.0.0.1:3999`); `launchctl list | grep com.sampolio.app`;
  `curl -skI https://<your-domain>/ | head -1` (expect `307`).

**Backups** — a daily snapshot runs via a launchd agent
(`com.example.sampolio_backup`) pointed at a backup script kept outside this repo:
a `tar.gz` of `~/.sampolio` (top-level `data/`), integrity-checked locally, then
copied to each backup target. Tarball the data dir before each deploy too
(`~/sampolio-data-backup-<timestamp>.tar.gz`). Every tar **excludes**
`data/.encryption_key`, `data/.auth_secret`, `data/.auth_url` (a backup must not
carry the key that decrypts it — keep `ENCRYPTION_KEY` in a password manager)
and the live `data/sampolio.db`, `-wal`, `-shm` (a hot copy can be torn); it
**includes** `data/snapshots/sampolio.db`, the consistent encrypted copy the app
writes on boot, every 6 h and daily at 04:55 (before the 05:10 backup) —
refresh it on demand with `DATA_DIR=$HOME/.sampolio/data node scripts/db-snapshot.mjs`
(safe while the app runs). Never write to `~/.sampolio/data` except those
snapshots.

**Restore the auth DB from a snapshot** — stop the app, move the live
`sampolio.db`, `sampolio.db-wal`, `sampolio.db-shm` aside (never delete them),
`cp data/snapshots/sampolio.db data/sampolio.db`, `chmod 600` it, start the app.
The snapshot opens with the same `ENCRYPTION_KEY`; sessions/passkeys added after
the snapshot are lost (users sign in again).

**Rollback to a pre-4.0 build** — check out the previous tag, rebuild, kickstart.
The legacy `users-index.enc` / `users/*/user.enc` are never modified by 4.x, so the
old build signs users in as before; move `sampolio.db*` aside (don't delete).
Password changes, passkeys and users created after the cutover are not in the
`.enc` files and are lost on rollback.

**Cloudflare Access changes** (login methods, allow-list, session length) are made
in the Cloudflare Zero Trust dashboard or via the API:
- Identity providers: `/accounts/{account_id}/access/identity_providers`
- App + policies: `/accounts/{account_id}/access/apps/{app_id}` and `…/policies`
- **Add an allowed user:** append their email to the "Sampolio" app's allow policy.
- **Revoke all sessions** (lost device): Zero Trust → *Access → revoke*, or the API.
- **Change session length:** the app's `session_duration` (max `730h`).

**Consent renewal** — Enable Banking consent is time-boxed; the app surfaces a
reconnect banner before expiry (Overview) and a Reconnect button in
*Settings → Accounts & Banking*.

## 7. Repo scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `server-deploy.sh` | Build in place from the git clone: pins Node from `.nvmrc`, `pnpm install`, builds into **`.next-prod`** (`NEXT_DIST_DIR`), so a parallel `next dev` (which uses `.next`) can never clobber what `next start` serves. Flags: `--pull` (ff-only pull first), `--run` (start foreground after build). This is the normal deploy path. |
| `install-launchd.sh` | Installs `com.sampolio.app` (`~/Library/LaunchAgents/`): resolves the Node binary from `.nvmrc` at install time and bakes it + the env from `~/sampolio/.env` into the plist, so boot doesn't depend on an interactive shell. The plist holds `AUTH_SECRET` and `ENCRYPTION_KEY`, so it is written owner-only (mode `0600`; launchd loads it fine). Build with `server-deploy.sh` first. |
| `uninstall-launchd.sh` | Removes the launchd agent. |
| `run-sampolio.sh` | Starts the app in the foreground from the in-place build (dev/diagnostic use). |
| `reencrypt-data.mjs` | One-shot re-encryption of every `.enc` file into the fast **HKDF** key-derivation format (see §8). `--dry-run` supported. |
| `rotate-encryption-key.mjs` | Rotates the data set to a **new** `ENCRYPTION_KEY`: decrypts every `.enc` with `OLD_ENCRYPTION_KEY`, re-encrypts with the new key, then `PRAGMA hexrekey`s `sampolio.db` and rewrites its snapshot (see §8). `--dry-run` supported. |
| `db-snapshot.mjs` | `pnpm db:snapshot`: verified encrypted `VACUUM INTO` copy of `sampolio.db` → `<DATA_DIR>/snapshots/sampolio.db` (key from `ENCRYPTION_KEY` or `<DATA_DIR>/.encryption_key`). Safe while running. |
| `sqlcipher-lib.mjs` | Shared SQLCipher helpers for the two scripts above; mirrors `src/lib/db/sqlite/{key,client,snapshot}.ts`. |
| `generate-icons.mjs` | Regenerates the committed PWA PNG icon set from the master SVGs in `public/icons/` (uses `sharp`). Run after editing the SVGs. |
| `lib-node.sh` | Shared shell helpers (Node/nvm resolution) sourced by the other scripts. |

## 8. Encryption maintenance

All data files are AES-256-GCM with a per-file key derived from `ENCRYPTION_KEY`
via **HKDF-SHA256**; the read path falls back to the legacy PBKDF2 derivation for
old files (see `src/lib/db/encryption.ts` and `src/lib/db/AGENTS.md`).

**Re-encrypting to the fast format** — `node scripts/reencrypt-data.mjs [--dry-run]`
rewrites every `.enc` file under `DATA_DIR` (default `./data`; key from
`ENCRYPTION_KEY` env or `<DATA_DIR>/.encryption_key`) using HKDF. It is a
*performance* migration, not a correctness one: idempotent, atomic per file
(temp-write + rename), never deletes data. Take a backup first anyway. To run it
against production data, stop the app, back up, run with
`DATA_DIR=$HOME/.sampolio/data`, restart.

**Key rotation** — `OLD_ENCRYPTION_KEY=<old> ENCRYPTION_KEY=<new>
node scripts/rotate-encryption-key.mjs [--dry-run]` decrypts every `.enc` file
with the old key (HKDF with PBKDF2 fallback) and re-encrypts it with the new key
(HKDF). It refuses to run when the two keys are identical (that is
`reencrypt-data.mjs`'s job). Atomic per file, but a crash mid-run leaves the
tree mixed between keys — **stop the app and take a backup first**; re-running
with the same env resumes safely (already-rotated files are detected via the
new key and skipped). The same run rekeys the SQLCipher DB: `sampolio.db` is keyed
with HKDF(`ENCRYPTION_KEY`, `sampolio-sqlite-v1`), so it opens with the old derived
key → `PRAGMA hexrekey` to the new one (in rollback-journal mode, then back to WAL)
→ a fresh snapshot under the new key; a DB that already opens with the new key is
reported and left alone. Old backups keep their old key. Afterwards update
`<DATA_DIR>/.encryption_key` and reload the launchd plist env (see §6 for the
full-reload nuance).

**Missing `ENCRYPTION_KEY` is a hard failure in production**: the app throws on
the first data read/write instead of falling back to the publicly known dev
default key. In development the fallback (plus a console warning) remains.

## 9. Environment variable reference

Every variable the code reads (`grep -r "process.env" src scripts next.config.ts`):

| Variable | Required | Read in | Meaning |
|---|---|---|---|
| `ENCRYPTION_KEY` | yes | `db/encryption.ts`, `db/sqlite/key.ts`, `reencrypt-data.mjs`, `rotate-encryption-key.mjs`, `db-snapshot.mjs` | AES-256-GCM master key for all `.enc` files; the SQLCipher key for `sampolio.db` is derived from it (HKDF, `sampolio-sqlite-v1`). Prod value in `~/.sampolio/data/.encryption_key` (injected into the env by the plist/launch config — the app itself reads only the env). |
| `AUTH_SECRET` | yes | `lib/auth/server.ts` | Better Auth secret (signs session cookies). Changing it signs everyone out. |
| `AUTH_URL` | yes (throws in prod if unset) | `lib/auth/server.ts`, `api/bank/callback/route.ts` | Canonical app URL (prod domain; `http://localhost:4999` for the dev preview). Better Auth `baseURL`; its **hostname is the passkey RP ID**, so changing the domain orphans every registered passkey. The bank-callback route reads it to build the external redirect base. |
| `DATA_DIR` | no (default `./data`) | `db/encryption.ts`, scripts | Root of the encrypted data tree. Prod: `~/.sampolio/data`. |
| `OLD_ENCRYPTION_KEY` | rotation only | `rotate-encryption-key.mjs` | The previous master key when rotating to a new `ENCRYPTION_KEY` (§8). Never read by the app. |
| `NEXT_DIST_DIR` | no (default `.next`) | `next.config.ts` | Build output dir; prod sets `.next-prod` to isolate from dev. |
| `DEV_AUTH_BYPASS` | dev only | `lib/auth/server.ts`, `app/dev-login/` | Email of an existing user; visiting `/dev-login` signs in as them without a password. Never set in prod. |
| `ENABLE_BANKING_APP_ID` | bank sync only | `lib/bank/*` | Enable Banking application id (JWT `kid`). All three `ENABLE_BANKING_*` must be present or the feature hard-disables. |
| `ENABLE_BANKING_REDIRECT_URL` | bank sync only | `lib/bank/*` | Consent callback URL (`https://<your-domain>/api/bank/callback`). |
| `ENABLE_BANKING_PRIVATE_KEY_FILE` | bank sync only | `lib/bank/jwt.ts` | Path to the 0600 RS256 PKCS#8 PEM (outside the repo). |
| `ENABLE_BANKING_BASE_URL` | no | `lib/bank/constants.ts` | API base override (sandbox); unset in prod. |
| `BANK_SYNC_VERBOSE` | no | `lib/bank/` | `1/true/yes` → verbose sync logging. |
| `HA_WEBHOOK_URL` | no | `lib/split-notify.ts` | Full Home Assistant webhook URL **including the secret webhook id** (e.g. `https://<ha-host>/api/webhook/<id>`) that split-activity notifications are POSTed to. Missing/blank ⇒ the feature hard-disables (zero network calls); `AUTH_URL` doubles as the deep-link base and must also be set. Never logged. |
| `NODE_ENV` / `NEXT_RUNTIME` | set by Next | various | Standard runtime flags (e.g. service-worker registration is production-only; the bank scheduler starts only on the Node runtime). |

## 10. Dev workflow against a copy of production data

Covered in detail in [`AGENTS.md`](../AGENTS.md) §"Testing With a Copy of
Production Data". Short version: `rsync -a ~/.sampolio/data/ ./data/` (one
direction only — never back), then the `sampolio-preview` config in
`.claude/launch.json` starts `next dev -p 4999` with the dot-file secrets
exported, `DATA_DIR=$PWD/data`, and `DEV_AUTH_BYPASS` enabled (`/dev-login`).
Port 3999 belongs to production (launchd `KeepAlive` restarts it if killed) —
never point a dev server at prod's port or data dir.

## 11. What is intentionally NOT in this repo

Kept out of version control (this is a public repo): the `.env` secrets, the PEM
key, the Cloudflare account/app/IdP IDs, the tunnel UUID, the Zero Trust team
domain, and the allow-listed personal emails. Real values live in `~/sampolio/.env`,
`~/.sampolio/`, and the Cloudflare dashboard. The daily backup script and its
launchd plist also live outside the repo.
