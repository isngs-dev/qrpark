-- Sprint 4b: POST /payments/:id/cancel is audited as PAYMENT_CANCELLED.
-- audit_action is a Postgres enum, so the new value needs this migration;
-- nothing else in the database changes (a cancelled payment is ABANDONED).
ALTER TYPE "audit_action" ADD VALUE 'PAYMENT_CANCELLED';
