# QR Parking

QR-ticket parking for Garki International Market's festive season. A small,
standalone app that runs until the full E-Parking system is live. One QR
ticket per vehicle, three jobs:

1. **Entry**: the entry operator picks the vehicle category; the backend
   creates the ticket at once (UNPAID, the category's price snapshotted on it,
   valid until the end of the day in Africa/Lagos) and the app prints the QR.
2. **Payment booth**: the payment operator scans the ticket and takes **cash**
   (one "Confirm ₦N cash received" tap) or **card** (Paystack checkout). The
   ticket becomes PAID only on that cash confirmation or on Paystack's
   confirmation.
3. **Exit**: the exit operator scans the same QR once. Only a PAID ticket,
   not yet validated and issued today, is let out; a second scan says
   "Already used".

Every operator can also **check** a ticket (read-only). `docs/01-flow.md` is
the master reference for behaviour.

## Parts

- `backend/`: NestJS + Prisma + PostgreSQL + Redis. The API and all rules.
- `admin/`: Next.js + Tailwind Admin Portal (ADMIN only).
- `android/`: one Kotlin app, Android 10+. Entry, Booth and Exit modes (the
  mode comes from the account's role) are built in Sprint 4; today it is the
  Sprint 0 placeholder.

## Docs

`CLAUDE.md` holds the build rules and locked decisions. `docs/` has the flow
(`01-flow.md`), scope, sprints, known issues, `schema.md` (every table) and
`api.md` (every endpoint).

## Run locally

```bash
docker compose up -d                 # Postgres on 5433, Redis on 6380
cd backend && npm ci
cp .env.example .env                 # then fill in the values (see below)
npx prisma migrate deploy
npm run build && npm run seed:site && npm run seed:test-data
npm run start:dev                    # http://localhost:3000/health
```

`backend/.env` is ignored by git and is the only place local values live:
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SITE_CODE` (a test site's code
must end in `-test`), `SITE_NAME`, and for the first run `ADMIN_USERNAME`,
`ADMIN_PASSWORD` (12+ characters) and `ADMIN_NAME`. Paystack: see Secrets.

### Seeds

- `npm run seed:site` creates the site, its settings and the first admin
  (from `ADMIN_USERNAME` / `ADMIN_PASSWORD`). It never changes what exists.
- `npm run seed:test-data` (test sites only) adds TEST categories and prices,
  the locations `ENTRY_1`, `BOOTH_1`, `BOOTH_2` and `EXIT_1`, and one account
  per job:

  | Username | Job | Location |
  |---|---|---|
  | `entry-1` | ENTRY_OPERATOR | `ENTRY_1` |
  | `booth-1` | PAYMENT_OPERATOR | `BOOTH_1` |
  | `exit-1` | EXIT_OPERATOR | `EXIT_1` |

  A new account's password is printed **once**, by the seed, and stored only
  as its hash. Keep each one in your own `backend/.env` (for example as
  `TEST_ENTRY_1_PASSWORD`) or reset it in the Admin Portal; never commit or
  share it in chat. A second run creates nothing and shows no password.

All prices in the seeds are TEST VALUES until Garki's real categories and
prices are confirmed.

### Tests

Tests need a separate database whose name ends in `_test`; they refuse any
other. Paystack is a fake in every test.

```bash
docker compose exec postgres createdb -U qrpark qrpark_test
DATABASE_URL=postgresql://qrpark:qrpark@localhost:5433/qrpark_test npx prisma migrate deploy
DATABASE_URL=postgresql://qrpark:qrpark@localhost:5433/qrpark_test REDIS_URL=redis://localhost:6380 npm test
```

### Admin Portal and Android

Admin Portal: `cd admin && npm ci && npm run dev` (http://localhost:3000;
start it on another port if the backend is running, e.g. `npx next dev -p 3001`).

Android debug build: Gradle 8.9 needs **JDK 21** (Android Studio's bundled JBR
25 is too new). Set `JAVA_HOME` to a JDK 21, then run `gradle -p android
assembleDebug`. The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

## Secrets

Nothing secret is ever committed: no keys, passwords or tokens. `.env` is
ignored by git; `.env.example` lists the variables with empty values.
Paystack test keys only, until go-live is approved: put your `sk_test_` key
in `backend/.env` as `PAYSTACK_SECRET_KEY` yourself. The backend refuses to
start with a live key, and the tests never use the real one.
