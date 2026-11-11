# 08 — Secrets and go-live (Sprint 6a)

## Secrets and settings on the server

All live in **`/opt/qrpark/.env`** on the droplet: mode 600, owner `deploy`,
never in git, never printed, never pasted in chat. Names only here; how each
is made is in `docs/07-deploy-digitalocean.md` step 6.

| Name | Secret? | Made how | Used by |
|---|---|---|---|
| `POSTGRES_PASSWORD` | yes | `openssl rand -hex 32` on the server | postgres, api, migrate, seed |
| `REDIS_PASSWORD` | yes | `openssl rand -hex 32` on the server | redis, api |
| `JWT_SECRET` | yes | `openssl rand -base64 48` on the server | api (tokens; also keys the sign-in throttle hashes) |
| `QRPARK_CLIENT_ADDRESS_SECRET` | yes | `openssl rand -hex 32` on the server, once | api and portal (T13), the same value |
| `PAYSTACK_SECRET_KEY` | yes | typed at a hidden prompt, from qrpark's own Paystack **test** business (`sk_test_...`) | api |
| `SEED_ADMIN_PASSWORD`, `SEED_ENTRY_PASSWORD`, `SEED_BOOTH_PASSWORD`, `SEED_EXIT_PASSWORD` | yes, **temporary** | typed at a hidden prompt for seeding, then **deleted from `.env`**. 12+ characters, not obvious, and **without `$` `#` `'` `"` `` ` `` `\` or spaces** (the seed refuses them: `.env` would store them mangled) | seed service only |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_NAME` | no, temporary | typed; deleted with the passwords | seed service only |
| `API_HOST`, `ADMIN_HOST` | no | `qrpark-api.gsds.com.ng`, `qrpark-admin.gsds.com.ng` (or the sslip.io fallback) | caddy, portal |
| `ACME_EMAIL` | no | typed (Let's Encrypt notices) | caddy |
| `DROPLET_IP` | no | typed (the DNS check and the sslip.io fallback) | the runbook |
| `SITE_CODE`, `SITE_NAME` | no | `garki-test` and a display name | api, seed |
| `QRPARK_TAG` | no | the deployed commit (`git rev-parse --short HEAD`) | compose (image tags) |

Outside `.env`, kept elsewhere:

| What | Where |
|---|---|
| SSH private key `qrpark_do` | your laptop only (`%USERPROFILE%\.ssh\qrpark_do`) |
| The `deploy` user's sudo password | your password manager |
| The repository deploy key `~/.ssh/qrpark_repo` | the droplet only; its public half in GitHub (read-only) |
| Operators' and the admin's passwords | your password manager; handed over in person |
| Database backups | `/var/backups/qrpark` (mode 600) and copies on an encrypted drive |
| Paystack dashboard login | your password manager (Paystack's own two-factor) |

Not secrets, never configured: device lists (no device registry), Caddy's
certificates (made and renewed by Caddy, kept in its data volume).

## Go-live checklist (production, after the test run)

Nothing below is done in Sprint 6a. Each item needs a decision or an action
by the owner.

- [ ] **Production host decided** (open question in CLAUDE.md; test runs on one DigitalOcean droplet).
- [ ] **Paystack live keys**: go-live approved; a live secret key (`sk_live_...`) in the production `.env` only; the backend's refusal of live keys lifted by a reviewed change; the live webhook URL set in Paystack's live settings.
- [ ] **T6 decided** (docs/05-known-issues.md).
- [ ] **Release keystore** for the Android app: your own keystore, made and kept by you, never in the repo; the release APK signed with it.
- [ ] **Backups copied off the server** on a schedule (docs/07 step 11), with one restore rehearsed from an off-server copy.
- [ ] **Real categories and prices** for Garki entered in the portal (the seeds' prices are TEST VALUES), and the organisation name and contact text for the ticket.
- [ ] **No test data in production**: production is a new site code (not ending in `-test`), seeded with `seed-site` only; `seed-test-data` refuses it.
- [ ] **The admin changes the seeded admin password** after the first sign-in (Operators → own row → Set password; there is no separate "change my password" page with the current password) and every `SEED_*` line is gone from `.env` (`grep -c '^SEED_' .env` prints 0).
- [ ] **Uptime monitor** on the production `/health`, alerting someone who can act.
- [ ] **Reboot test** on the production server: reboot it; every service comes back by itself (`restart: unless-stopped`), healthy, `/health` answers, the backup timer is still listed.
- [ ] **Redis check** on the production server: `CONFIG GET` shows `maxmemory` 256 MB, `maxmemory-policy noeviction` and `appendonly yes`, and finished jobs do not pile up (job retention). Closes L3 on the test droplet first (6b).
- [ ] **Forged `X-Forwarded-For` check** against the real Caddy: wrong sign-ins sent with a forged header are counted for the real client address, through the api and through the portal (as proved locally in 6a).
- [ ] **DNS**: the production names' A records in GoDaddy DNS, checked against `ns57`/`ns58.domaincontrol.com` before Caddy starts.
- [ ] **Known issues** in docs/05 reviewed: every one closed or accepted in writing (including T15, the flaky throttle-key test, and L1, the portal's npm audit finding).
