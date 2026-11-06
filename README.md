# QR Parking

QR-ticket parking for Garki International Market's festive season. A small,
standalone app that runs until the full E-Parking system is live: entry
operators take a Paystack payment and print a QR ticket; exit operators scan
it once to close it.

## Parts

- `backend/`: NestJS + Prisma + PostgreSQL + Redis. The API and all rules.
- `admin/`: Next.js + Tailwind Admin Portal (ADMIN only).
- `android/`: one Kotlin app with Entry and Exit modes, Android 10+.

## Docs

`CLAUDE.md` holds the build rules and locked decisions. `docs/` has the
flow (`01-flow.md`, the master reference), scope, sprints, known issues,
`schema.md` (every table) and `api.md` (every endpoint).

## Run locally

```bash
docker compose up -d                 # Postgres on 5433, Redis on 6380
cd backend && npm ci
cp .env.example .env                 # then fill in JWT_SECRET and the admin
npx prisma migrate deploy
npm run build && npm run seed:site && npm run seed:test-data
npm run start:dev                    # http://localhost:3000/health
```

Tests need a separate database whose name ends in `_test`; they refuse any other:

```bash
docker compose exec postgres createdb -U qrpark qrpark_test
DATABASE_URL=postgresql://qrpark:qrpark@localhost:5433/qrpark_test npx prisma migrate deploy
DATABASE_URL=postgresql://qrpark:qrpark@localhost:5433/qrpark_test REDIS_URL=redis://localhost:6380 npm test
```

Admin Portal: `cd admin && npm ci && npm run dev` (http://localhost:3000;
start it on another port if the backend is running, e.g. `npx next dev -p 3001`).

Android debug build: Gradle 8.9 needs **JDK 21** (Android Studio's bundled JBR
25 is too new). Set `JAVA_HOME` to a JDK 21, then run `gradle -p android
assembleDebug`. The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

## Secrets

Nothing secret is ever committed: no keys, passwords or tokens. `.env` is
ignored by git; `.env.example` lists the variables with empty values.
Paystack test keys only, until go-live is approved.
