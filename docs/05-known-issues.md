# 05 — Known issues

The tracker. One row per issue. IDs: H (high), M (medium), L (low), T
(temporary). Never delete a row; mark it fixed with the commit.

| ID | Status | Found | Issue | Notes |
|---|---|---|---|---|
| L1 | Open | Sprint 0 | npm audit: 1 high, 1 moderate in postcss bundled inside next@15.5.29; only fix is next@16 (breaking). We process no untrusted CSS. | Revisit in Sprint 5. |
