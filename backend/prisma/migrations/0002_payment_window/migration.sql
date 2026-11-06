-- AlterTable
ALTER TABLE "site_setting" ADD COLUMN     "payment_window_minutes" INTEGER NOT NULL DEFAULT 5;

-- How long a PENDING payment blocks its operator before it is ABANDONED.
ALTER TABLE "site_setting"
  ADD CONSTRAINT "site_setting_payment_window_minutes_check"
    CHECK ("payment_window_minutes" BETWEEN 1 AND 30);
