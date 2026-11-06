# 05 — Known issues

The tracker. One row per issue. IDs: H (high), M (medium), L (low), T
(temporary). Never delete a row; mark it fixed with the commit.

| ID | Status | Found | Issue | Notes |
|---|---|---|---|---|
| L1 | Open | Sprint 0 | npm audit: 1 high, 1 moderate in postcss bundled inside next@15.5.29; only fix is next@16 (breaking). We process no untrusted CSS. | Revisit in Sprint 5. |
| M1 | Open | Sprint 1 | No login throttling yet: `POST /auth/login` can be tried without limit. Argon2id slows each guess but does not stop an online attack. | Decide before go-live. Not built. |
| T1 | Open | Sprint 1 | Default ticket validity is 12 hours, an assumption for testing. `seed-site` sets 12 on every new site. | Confirm the validity default before go-live (editable in the Admin Portal, 1–72). |
| T2 | Open | Sprint 1 | Receipt branding (logos, organisation name, contact line) is an open question. `site_setting` has organisation name and contact line only; no logo column. | Add a logo choice when branding is answered. |
| L2 | Open | Sprint 1 | `audit_log` TRUNCATE is not blocked by the append-only trigger (it guards UPDATE and DELETE only). | At deploy, the app's database user must not hold the TRUNCATE privilege. Sprint 6. |
| L3 | Open | Sprint 2 | BullMQ (the verify and sweep jobs) needs Redis to run with `maxmemory-policy noeviction`; any evicting policy can silently drop queued jobs. | Set at deploy. Sprint 6. |
