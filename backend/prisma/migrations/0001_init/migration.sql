-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'ENTRY_OPERATOR', 'EXIT_OPERATOR');

-- CreateEnum
CREATE TYPE "gate_direction" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('ACTIVE', 'USED');

-- CreateEnum
CREATE TYPE "scan_kind" AS ENUM ('CHECK', 'EXIT');

-- CreateEnum
CREATE TYPE "scan_result" AS ENUM ('VALID', 'ACTIVE', 'ALREADY_USED', 'EXPIRED', 'INVALID_QR', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_PRICE_CHANGED', 'SETTINGS_CHANGED', 'GATE_CREATED', 'GATE_UPDATED', 'USER_CREATED', 'USER_UPDATED', 'USER_PASSWORD_RESET', 'TICKET_REPRINTED');

-- CreateTable
CREATE TABLE "site" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_setting" (
    "site_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "validity_hours" INTEGER NOT NULL,
    "receipt_org_name" TEXT,
    "receipt_contact_line" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_setting_pkey" PRIMARY KEY ("site_id")
);

-- CreateTable
CREATE TABLE "gate" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "gate_direction" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "gate_id" UUID,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_category" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_kobo" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "operator_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "customer_name" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "authorization_url" TEXT,
    "access_code" TEXT,
    "paystack_event" JSONB,
    "paid_at" TIMESTAMPTZ(6),
    "paystack_paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "operator_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "category_name" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "customer_name" TEXT,
    "payment_reference" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validity_hours" INTEGER NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'ACTIVE',
    "used_at" TIMESTAMPTZ(6),
    "used_gate_id" UUID,
    "used_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_event" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "ticket_id" UUID,
    "kind" "scan_kind" NOT NULL,
    "result" "scan_result" NOT NULL,
    "gate_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "device_ref" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "audit_action" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "detail" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_code_key" ON "site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "gate_site_id_code_key" ON "gate"("site_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_site_id_username_key" ON "app_user"("site_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_category_site_id_code_key" ON "vehicle_category"("site_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reference_key" ON "payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotency_key_key" ON "payment"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_site_id_status_idx" ON "payment"("site_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_payment_id_key" ON "ticket"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_token_key" ON "ticket"("token");

-- CreateIndex
CREATE INDEX "ticket_site_id_status_valid_until_idx" ON "ticket"("site_id", "status", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_site_id_ticket_number_key" ON "ticket"("site_id", "ticket_number");

-- CreateIndex
CREATE INDEX "scan_event_site_id_occurred_at_idx" ON "scan_event"("site_id", "occurred_at");

-- CreateIndex
CREATE INDEX "scan_event_ticket_id_idx" ON "scan_event"("ticket_id");

-- CreateIndex
CREATE INDEX "audit_log_site_id_occurred_at_idx" ON "audit_log"("site_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_site_id_target_type_target_id_idx" ON "audit_log"("site_id", "target_type", "target_id");

-- AddForeignKey
ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate" ADD CONSTRAINT "gate_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_category" ADD CONSTRAINT "vehicle_category_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "vehicle_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_used_gate_id_fkey" FOREIGN KEY ("used_gate_id") REFERENCES "gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_event" ADD CONSTRAINT "scan_event_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_event" ADD CONSTRAINT "scan_event_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_event" ADD CONSTRAINT "scan_event_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_event" ADD CONSTRAINT "scan_event_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Rules Prisma schema syntax cannot express. Each is named so a violation
-- names the rule, and each has a test in src/db/constraints.lifecycle.test.ts.
-- See docs/schema.md.
-- ===========================================================================

-- site_setting ---------------------------------------------------------------
ALTER TABLE "site_setting"
  ADD CONSTRAINT "site_setting_display_name_check"
    CHECK ("display_name" = btrim("display_name") AND char_length("display_name") BETWEEN 1 AND 100),
  ADD CONSTRAINT "site_setting_validity_hours_check"
    CHECK ("validity_hours" BETWEEN 1 AND 72),
  ADD CONSTRAINT "site_setting_receipt_org_name_check"
    CHECK ("receipt_org_name" IS NULL OR char_length("receipt_org_name") BETWEEN 1 AND 120),
  ADD CONSTRAINT "site_setting_receipt_contact_line_check"
    CHECK ("receipt_contact_line" IS NULL OR char_length("receipt_contact_line") BETWEEN 1 AND 120);

-- gate -----------------------------------------------------------------------
ALTER TABLE "gate"
  ADD CONSTRAINT "gate_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,31}$');

-- app_user -------------------------------------------------------------------
ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_username_check" CHECK ("username" ~ '^[a-z0-9._-]{3,32}$'),
  -- An admin has no gate; an operator has exactly one.
  ADD CONSTRAINT "app_user_gate_by_role_check" CHECK (
    ("role" = 'ADMIN' AND "gate_id" IS NULL) OR ("role" <> 'ADMIN' AND "gate_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "app_user_token_version_check" CHECK ("token_version" >= 0);

-- vehicle_category -----------------------------------------------------------
ALTER TABLE "vehicle_category"
  ADD CONSTRAINT "vehicle_category_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  -- INTEGER already refuses fractions; this refuses zero and negatives.
  ADD CONSTRAINT "vehicle_category_price_kobo_check" CHECK ("price_kobo" > 0);

-- payment --------------------------------------------------------------------
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_kobo_check" CHECK ("amount_kobo" > 0),
  ADD CONSTRAINT "payment_reference_check" CHECK (char_length("reference") BETWEEN 1 AND 100),
  ADD CONSTRAINT "payment_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 1 AND 100),
  ADD CONSTRAINT "payment_customer_name_check"
    CHECK ("customer_name" IS NULL OR char_length("customer_name") BETWEEN 1 AND 100),
  -- paid_at is the backend's time when SUCCESS was recorded, and only then.
  ADD CONSTRAINT "payment_paid_at_iff_success_check"
    CHECK (("status" = 'SUCCESS') = ("paid_at" IS NOT NULL));

-- One PENDING payment per operator. A partial unique index: a read-then-write
-- check alone loses to two simultaneous taps.
CREATE UNIQUE INDEX "payment_one_pending_per_operator"
  ON "payment" ("operator_id")
  WHERE "status" = 'PENDING';

-- ticket ---------------------------------------------------------------------
ALTER TABLE "ticket"
  -- 32 random bytes, base64url, no padding.
  ADD CONSTRAINT "ticket_token_check" CHECK ("token" ~ '^[A-Za-z0-9_-]{43}$'),
  -- No 0/O, 1/I/L.
  ADD CONSTRAINT "ticket_ticket_number_check"
    CHECK ("ticket_number" ~ '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$'),
  ADD CONSTRAINT "ticket_amount_kobo_check" CHECK ("amount_kobo" > 0),
  ADD CONSTRAINT "ticket_validity_hours_check" CHECK ("validity_hours" BETWEEN 1 AND 72),
  ADD CONSTRAINT "ticket_valid_until_check"
    CHECK ("valid_until" = "paid_at" + "validity_hours" * interval '1 hour'),
  ADD CONSTRAINT "ticket_customer_name_check"
    CHECK ("customer_name" IS NULL OR char_length("customer_name") BETWEEN 1 AND 100),
  -- The three used_* columns are set together, and only on a USED ticket.
  ADD CONSTRAINT "ticket_used_fields_check" CHECK (
    ("status" = 'USED') = ("used_at" IS NOT NULL)
    AND ("used_at" IS NULL) = ("used_gate_id" IS NULL)
    AND ("used_at" IS NULL) = ("used_by_id" IS NULL)
  ),
  -- An expired ticket cannot be marked used.
  ADD CONSTRAINT "ticket_used_before_expiry_check"
    CHECK ("used_at" IS NULL OR "used_at" <= "valid_until");

-- A ticket only for a SUCCESS payment. Checked on INSERT only, so a payment's
-- status may change later (Phase 2 refunds and cancellations) without
-- touching its ticket. FOR SHARE locks the payment row until this
-- transaction ends, so its status cannot change between the check and the
-- insert.
CREATE FUNCTION "ticket_requires_success_payment"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payment_status "payment_status";
BEGIN
  SELECT "status" INTO payment_status FROM "payment" WHERE "id" = NEW."payment_id" FOR SHARE;
  IF payment_status IS DISTINCT FROM 'SUCCESS' THEN
    RAISE EXCEPTION 'ticket refused: payment % is %, not SUCCESS', NEW."payment_id", coalesce(payment_status::text, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ticket_requires_success_payment"
  BEFORE INSERT ON "ticket"
  FOR EACH ROW EXECUTE FUNCTION "ticket_requires_success_payment"();

-- scan_event -----------------------------------------------------------------
ALTER TABLE "scan_event"
  ADD CONSTRAINT "scan_event_result_by_kind_check" CHECK (
    ("kind" = 'CHECK' OR "result" <> 'ACTIVE') AND ("kind" = 'EXIT' OR "result" <> 'VALID')
  ),
  -- A scan names its ticket exactly when it found one.
  ADD CONSTRAINT "scan_event_ticket_by_result_check"
    CHECK (("ticket_id" IS NULL) = ("result" IN ('NOT_FOUND', 'INVALID_QR'))),
  ADD CONSTRAINT "scan_event_device_ref_check" CHECK (char_length("device_ref") BETWEEN 1 AND 64);

-- audit_log: append-only ----------------------------------------------------
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();
