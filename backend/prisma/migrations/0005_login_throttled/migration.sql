-- Hardening H1 (M1): the sign-in throttle's audit row.
--
-- LOGIN_THROTTLED is written when a block starts. Nobody is signed in at that
-- moment, so it is the one action without an actor: actor_id becomes
-- nullable, and a CHECK keeps every other action's actor required. The
-- comparison is on the text of the action, so this script does not use the
-- new enum value in the transaction that adds it.

ALTER TYPE "audit_action" ADD VALUE 'LOGIN_THROTTLED';

ALTER TABLE "audit_log" ALTER COLUMN "actor_id" DROP NOT NULL;

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_actor_required_check"
  CHECK ("actor_id" IS NOT NULL OR "action"::text = 'LOGIN_THROTTLED');
