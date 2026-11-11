-- Sprint 6a (known issue L2): audit_log refuses TRUNCATE.
--
-- The append-only trigger of 0001 is a ROW trigger (UPDATE, DELETE); TRUNCATE
-- fires no row triggers, so it emptied the table. A STATEMENT trigger BEFORE
-- TRUNCATE closes that, also when the TRUNCATE reaches audit_log by CASCADE
-- from a table it references. Same function, same message:
-- "audit_log is append-only: TRUNCATE refused". Touches no row.

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();
