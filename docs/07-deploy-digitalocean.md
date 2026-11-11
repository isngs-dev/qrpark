# 07 — Deploying to DigitalOcean (Sprint 6a)

One droplet runs everything: Caddy (HTTPS), the api, the Admin Portal,
PostgreSQL 16 and Redis, with Docker Compose (`compose.prod.yml`). This is the
**test** environment; Paystack **test** keys only.

> **Status.** Every step below that runs on the droplet, in GoDaddy or in
> GitHub is **written but not run yet**. What was proved on a local rehearsal
> of the same compose file is listed in `.evidence/sprint-6a.txt` (local, not
> in git) and summarised at the end of this page.

Rules that hold throughout:

- **No secret is ever printed, pasted in chat, committed, or put in a ticket.**
  Secrets are made on the server with `openssl` straight into
  `/opt/qrpark/.env` (mode 600, owner `deploy`). The few you must type (the
  Paystack test key, the seed passwords) are typed at a hidden prompt.
- The droplet's address, host names and e-mail are **values in `.env`**
  (`DROPLET_IP`, `API_HOST`, `ADMIN_HOST`, `ACME_EMAIL`), not written in any
  file in git. Below, `<DROPLET_IP>` means that address.
- Names used here: host names `qrpark-api.gsds.com.ng` (api) and
  `qrpark-admin.gsds.com.ng` (portal); SSH key `qrpark_do`; deploy user
  `deploy`; checkout `/opt/qrpark`; backups `/var/backups/qrpark`.

---

## 1. The droplet and the Project — *not run yet (the droplet exists)*

The droplet already exists (Ubuntu 24.04, 2 vCPU / 4 GB / 120 GB, London),
created with the SSH key **`qrpark_do`**. In the DigitalOcean control panel,
put it in a Project named **QR Parking** (Projects → New Project, then Move
resources). Write its address only into your password manager and, later, into
`/opt/qrpark/.env` as `DROPLET_IP`.

On your laptop the private key is `%USERPROFILE%\.ssh\qrpark_do`.

## 2. First login, the deploy user, SSH — *not run yet*

From Windows PowerShell:

```powershell
ssh -i $HOME\.ssh\qrpark_do root@<DROPLET_IP>
```

On the droplet, as root:

```bash
apt-get update && apt-get -y upgrade
adduser --gecos "" deploy                 # set a strong password: it is for sudo only, keep it in your password manager
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

In a **second** PowerShell window, check that `deploy` can sign in before
locking root out:

```powershell
ssh -i $HOME\.ssh\qrpark_do deploy@<DROPLET_IP>
```

Then, as root, turn off password and root logins:

```bash
cat > /etc/ssh/sshd_config.d/10-qrpark.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t && systemctl reload ssh
```

Open a third session as `deploy` to confirm it still works, and check that
`ssh root@<DROPLET_IP>` is now refused. From here on, work as `deploy`
(`sudo` when needed).

## 3. Firewall and security updates — *not run yet*

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443        # HTTPS (tcp, and udp for HTTP/3)
sudo ufw enable
sudo ufw status verbose   # 22, 80, 443 only

sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # answer Yes: security updates install by themselves
```

Docker writes its own firewall rules for published ports, around ufw. Only
Caddy publishes ports, and only 80 and 443, which ufw allows anyway. Postgres
and Redis publish nothing (compose.prod.yml), so nothing else is reachable.

## 4. Docker — *not run yet*

Install Docker Engine and the Compose plugin from Docker's own apt repository
(the steps at https://docs.docker.com/engine/install/ubuntu/), then:

```bash
sudo usermod -aG docker deploy    # log out and back in afterwards
docker compose version
```

Membership of the `docker` group is equivalent to root: only `deploy` has it.

## 5. The code: a read-only deploy key — *not run yet*

The droplet reads the private repository **isngs-dev/qrpark** with a deploy
key made **on the server**. No personal token is ever used.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/qrpark_repo -N "" -C "qrpark droplet (read-only)"
cat ~/.ssh/qrpark_repo.pub          # the PUBLIC half only
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/qrpark_repo
  IdentitiesOnly yes
EOF
```

In GitHub: **isngs-dev/qrpark → Settings → Deploy keys → Add deploy key**,
title `qrpark droplet`, paste the public half, **leave "Allow write access"
unticked**. Then:

```bash
sudo install -d -o deploy -g deploy /opt/qrpark
git clone git@github.com:isngs-dev/qrpark.git /opt/qrpark
```

## 6. Secrets: `/opt/qrpark/.env` — *not run yet*

Every secret is generated here, into the file, and never shown. The names (no
values) are listed in `docs/08-secrets-and-go-live.md`.

```bash
cd /opt/qrpark
umask 077
{
  echo "API_HOST=qrpark-api.gsds.com.ng"
  echo "ADMIN_HOST=qrpark-admin.gsds.com.ng"
  echo "SITE_CODE=garki-test"
  echo "SITE_NAME=Garki International Market (test)"
  echo "QRPARK_TAG=$(git rev-parse --short HEAD)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
  echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
  echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
  echo "QRPARK_CLIENT_ADDRESS_SECRET=$(openssl rand -hex 32)"
} > .env
chmod 600 .env
```

Then the values you type (hidden; nothing appears on screen or in the shell
history):

```bash
cd /opt/qrpark
for name in DROPLET_IP ACME_EMAIL; do
  read -r -p "$name: " v && echo "$name=$v" >> .env
done
read -r -s -p "Paystack TEST secret key (sk_test_...): " v && echo && echo "PAYSTACK_SECRET_KEY=$v" >> .env; unset v
grep -c '^PAYSTACK_SECRET_KEY=sk_test_' .env    # must print 1: the backend refuses a live key anyway
ls -l .env                                      # -rw------- deploy deploy
```

`QRPARK_CLIENT_ADDRESS_SECRET` (T13) is made **once, here**, and the same
value goes to both the api and the portal through compose.prod.yml.

Paystack: qrpark has **its own Paystack test business**. Nothing points at
eparking's test business or its webhook.

## 7. DNS in GoDaddy — *not run yet*

DNS for **gsds.com.ng** is served by GoDaddy (nameservers
`ns57.domaincontrol.com` and `ns58.domaincontrol.com`). Add **two A records in
GoDaddy DNS**:

1. GoDaddy → **Domains → gsds.com.ng → DNS → Add New Record**.
2. Type **A**, Name **qrpark-api**, Value **`<DROPLET_IP>`**, TTL **600** (custom, seconds). Save.
3. Type **A**, Name **qrpark-admin**, Value **`<DROPLET_IP>`**, TTL **600**. Save.

**Check before starting Caddy.** Caddy asks Let's Encrypt for certificates as
soon as it starts, so both names must already answer with the droplet's
address. From Windows PowerShell, asking GoDaddy's own nameserver:

```powershell
Resolve-DnsName qrpark-api.gsds.com.ng   -Server ns57.domaincontrol.com -Type A
Resolve-DnsName qrpark-admin.gsds.com.ng -Server ns57.domaincontrol.com -Type A
```

Both must show `IPAddress` equal to `<DROPLET_IP>`. Repeat with
`-Server ns58.domaincontrol.com`. Only then go on to step 8's
`up -d caddy`. (On the droplet the same check is
`dig +short A qrpark-api.gsds.com.ng @ns57.domaincontrol.com`.)

**If DNS is delayed**, use sslip.io names, which answer by themselves: in
`.env` set `API_HOST=api.<dashed-ip>.sslip.io` and
`ADMIN_HOST=admin.<dashed-ip>.sslip.io` (for example `api.10-0-0-1.sslip.io`
for 10.0.0.1). Switch back to the real names later by editing `.env` and
running `docker compose -f compose.prod.yml up -d caddy portal` (the portal's
api address follows `API_HOST`).

## 8. Build and start — *not run yet*

```bash
cd /opt/qrpark
docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml up -d postgres redis migrate api portal
docker compose -f compose.prod.yml ps        # migrate: exited (0); api, portal: healthy
docker compose -f compose.prod.yml logs migrate | tail -5     # "All migrations have been successfully applied."
# after the DNS check of step 7:
docker compose -f compose.prod.yml up -d caddy
docker compose -f compose.prod.yml logs caddy | grep -i "certificate obtained"
```

Then from your laptop: `https://qrpark-api.gsds.com.ng/health` answers
`{"status":"ok",...}` and `https://qrpark-admin.gsds.com.ng/login` shows the
sign-in page.

## 9. Seeding — *not run yet*

The seeds run in the compose **`seed`** service: the api image, on the
internal network only (no database connection from outside the server). Only
this service receives the `SEED_*` passwords; the long-running api never
does. Type each password from your password manager at a hidden prompt. The
seed refuses anything else before it writes anything:

- 12 characters or more, not a common or obvious one (not containing the
  username, "password", "admin", "qrpark" or "garki");
- **none of these characters: `$` `#` `'` `"` `` ` `` `\` or a space.** Docker
  Compose reads `$` in `.env` as a variable and `#` as a comment, and quotes,
  backslash and spaces change the value, so such a password would be stored
  mangled and the account could not sign in. Letters, digits and other
  punctuation (for example `- _ . ! @ % ^ & * + = : ; , ? /`) are fine.

```bash
cd /opt/qrpark
read -r -p "Admin username: " v && echo "SEED_ADMIN_USERNAME=$v" >> .env
read -r -p "Admin display name: " v && echo "SEED_ADMIN_NAME=$v" >> .env
for name in SEED_ADMIN_PASSWORD SEED_ENTRY_PASSWORD SEED_BOOTH_PASSWORD SEED_EXIT_PASSWORD; do
  read -r -s -p "$name: " v && echo && echo "$name=$v" >> .env
done; unset v

docker compose -f compose.prod.yml --profile seed run --rm seed node dist/seed-site.js
docker compose -f compose.prod.yml --profile seed run --rm seed node dist/seed-test-data.js   # test site only
```

The output names what was created and never shows a password. A second run
creates nothing and never changes an existing account's password.

**Then remove the passwords from the server**, at once:

```bash
sed -i '/^SEED_/d' /opt/qrpark/.env
grep -c '^SEED_' /opt/qrpark/.env      # must print 0
```

Sign in to the portal as the admin and change the admin's password:
**Operators → your own row → Set password** (this ends your session; sign in
again with the new one). Hand each operator password over in person.

## 10. Paystack webhook (test) — *not run yet*

In **qrpark's own** Paystack test business: Settings → API Keys & Webhooks →
**Test Webhook URL** = `https://qrpark-api.gsds.com.ng/paystack/webhook`. Every
webhook's signature is verified with the test secret key; without the webhook,
card payments are still confirmed by the delayed checks and the sweep.

## 11. Backups — *not run yet on the server (proved locally)*

```bash
sudo install -d -m 700 -o deploy -g deploy /var/backups/qrpark
sudo cp /opt/qrpark/deploy/systemd/qrpark-backup.service /opt/qrpark/deploy/systemd/qrpark-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qrpark-backup.timer
sudo systemctl start qrpark-backup.service          # a first backup now
ls -l /var/backups/qrpark                           # -rw------- deploy deploy qrpark-<UTC stamp>.dump
systemctl list-timers qrpark-backup.timer           # next run: 02:30 Lagos time
/opt/qrpark/deploy/restore-check.sh                 # restores the newest dump into a scratch database and compares every table's row count
```

`backup.sh`: `pg_dump` (custom format, compressed) inside the postgres
container, checked readable before it is kept, mode 600, 14 days kept, prints
nothing unless it fails (then one line naming the failed step, in
`journalctl -u qrpark-backup`).

**Copy dumps off the server** (weekly at least, and before any risky change),
from Windows PowerShell:

```powershell
scp -i $HOME\.ssh\qrpark_do "deploy@<DROPLET_IP>:/var/backups/qrpark/qrpark-*.dump" D:\qrpark-backups\
```

Keep them on an encrypted drive (BitLocker): a dump holds every ticket,
payment, account name and password hash.

**Restoring after a disaster** (data written after the dump is lost):
stop the api and portal, drop and recreate the `qrpark` database, then
`docker exec -i qrpark-postgres-1 pg_restore -U qrpark -d qrpark --no-owner < <dump>`,
start the api and portal, check `/health` and the portal's dashboard.

## 12. Updating and rolling back — *not run yet*

**Update** to the newest commit on `main`:

```bash
cd /opt/qrpark
git fetch origin && git checkout --detach origin/main
TAG=$(git rev-parse --short HEAD)
sed -i "s/^QRPARK_TAG=.*/QRPARK_TAG=$TAG/" .env
sudo systemctl start qrpark-backup.service          # a backup before every update
docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml up -d            # runs migrate first, then the new api
echo "$(date -u +%FT%TZ) $TAG" >> ~/deployed-tags.log
```

**Roll back** to the previous release (its images are still on the server):

```bash
cd /opt/qrpark
PREV=<the tag before, from ~/deployed-tags.log>
git checkout --detach "$PREV"
sed -i "s/^QRPARK_TAG=.*/QRPARK_TAG=$PREV/" .env
docker compose -f compose.prod.yml up -d api portal caddy
```

Migrations only go forward. If the release being rolled back added a
migration, the older code may not run on the newer database: restore the
backup taken before the update (step 11) instead, and accept that data written
since then is lost. Remove old images now and then with `docker image prune`.

## 13. Logs — *not run yet*

Every service's Docker log is capped (compose.prod.yml, `x-logging`): the
`json-file` driver keeps at most **3 files of 10 MB** per container, the
oldest dropped first, so logs can never fill the disk. Read back on the local
rehearsal with `docker inspect`; on the droplet:
`docker inspect -f '{{.Name}} {{json .HostConfig.LogConfig}}' $(docker ps -aq)`.

```bash
docker compose -f compose.prod.yml logs --tail 200 api
docker compose -f compose.prod.yml logs --tail 200 portal
docker compose -f compose.prod.yml logs --tail 100 caddy
journalctl -u qrpark-backup --since today
```

What the logs never contain (tested in the backend suite): ticket tokens,
scanned text, passwords, Paystack keys, checkout links, access codes,
authorization codes, Paystack payloads, query text. Caddy writes no access log.
Before sharing a log, still read it: it names usernames and ticket numbers.

A sign-in blocked for an account (Hardening H1):
`docker compose -f compose.prod.yml exec api node dist/unthrottle.js <username>`.

## 14. Uptime check — *not run yet*

A free external monitor (for example UptimeRobot): an HTTPS keyword monitor on
`https://qrpark-api.gsds.com.ng/health`, keyword `"status":"ok"`, every 5
minutes, alerts by e-mail. `/health` is public on purpose and says only whether
the database and Redis are up.

## 15. A ticket from an earlier day (for Sprint 6b's EXPIRED case)

The API never takes a time, so the only way to have a ticket from an earlier
day is raw SQL on the **test** site. This makes one, issued 24 hours ago (its
`valid_until` is set by the database trigger to the end of THAT Lagos day), and
shows its ticket number and token once, for the tester:

```bash
docker compose -f compose.prod.yml exec -T postgres psql -U qrpark -d qrpark <<'SQL'
INSERT INTO ticket (id, site_id, idempotency_key, token, ticket_number, operator_id, gate_id, device_ref,
                    category_id, category_code, category_name, fee_kobo, issued_at, updated_at)
SELECT gen_random_uuid(), s.id, 'sql-earlier-day-' || gen_random_uuid(),
       rtrim(translate(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '='),
       'XPRD-TST3', u.id, u.gate_id, 'sql-6b', c.id, c.code, c.name, c.price_kobo,
       now() - interval '1 day', now()
  FROM site s
  JOIN app_user u ON u.site_id = s.id AND u.username = 'entry-1'
  JOIN vehicle_category c ON c.site_id = s.id AND c.code = 'CAR'
 WHERE s.code = 'garki-test'
RETURNING ticket_number, token, issued_at, valid_until;
SQL
```

Make a QR code of the token on the tester's laptop (any offline QR tool), or
type the token into the app's scan field. The booth must refuse to take
payment and the exit must answer **EXPIRED**. Change `XPRD-TST3` for each
further ticket (four letters or digits, a dash, four more; no I, L, O, 0, 1).

---

## Proved locally (rehearsal of compose.prod.yml), and what waits for the server

Proved on a local rehearsal (`deploy/compose.local-proof.yml`: local
certificates from Caddy, ports 8080/8443, fixed test client addresses):
both images build, run as a non-root user, contain no `.env` or key;
`migrate` applies all migrations before the api starts; every service is
healthy and only Caddy publishes ports; `/health` answers through Caddy with
the certificate verified; the portal reaches the api through Caddy over
https, trusting the local root properly; the T13 throttle keys on the real
client address through both the api and the portal, a forged
`X-Forwarded-For` changes nothing; seeding in the `seed` service prints no
password; the backup and the restore check; the `valid_until` proof; the
earlier-day ticket SQL above.

Waits for the server: steps 1 to 14 as written (droplet set-up, SSH, ufw,
unattended upgrades, Docker, deploy key, `.env`, GoDaddy DNS, Let's Encrypt
certificates, the systemd timer, the uptime monitor, the Paystack webhook).
