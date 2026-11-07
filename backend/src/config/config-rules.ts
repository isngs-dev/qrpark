import { BadRequestException } from '@nestjs/common';

/**
 * The rules that govern site configuration. Pure, so they are tested without
 * a database.
 *
 * Copied from eparking backend/src/config/config-rules.ts and adapted: a flat
 * price per category instead of pricing rules, and a payment window instead
 * of the pass, buffer and debounce settings. There is no validity setting.
 *
 * The database holds the same lines (vehicle_category_price_kobo_check,
 * site_setting_payment_window_minutes_check): these give a clear 400 first.
 */

/** INTEGER's ceiling. A larger value cannot be stored. */
export const MAX_KOBO = 2_147_483_647;

export const MIN_PAYMENT_WINDOW_MINUTES = 1;
export const MAX_PAYMENT_WINDOW_MINUTES = 30;


/** Long enough for any site's name; short enough to stay a header line or two. */
export const DISPLAY_NAME_MAX_LENGTH = 100;

/** A stable key a device can send: upper-case letters, digits, underscore. */
const CODE = /^[A-Z][A-Z0-9_]{0,31}$/;

export function assertCode(code: string, what: string): string {
  const trimmed = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!CODE.test(trimmed)) {
    throw new BadRequestException(
      `A ${what} code must be 1-32 characters: A-Z, 0-9 and underscore, starting with a letter`,
    );
  }
  return trimmed;
}

/** A price is a whole number of kobo, at least 1. Never a float, never naira. */
export function assertPriceKobo(value: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException('priceKobo must be a whole number of kobo');
  }
  if (value < 1) throw new BadRequestException('priceKobo must be at least 1 kobo');
  if (value > MAX_KOBO) throw new BadRequestException(`priceKobo must be at most ${MAX_KOBO}`);
}

/** How long a PENDING payment blocks its operator: whole minutes, 1-30. */
export function assertPaymentWindow(value: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException('paymentWindowMinutes must be a whole number of minutes');
  }
  if (value < MIN_PAYMENT_WINDOW_MINUTES || value > MAX_PAYMENT_WINDOW_MINUTES) {
    throw new BadRequestException(
      `paymentWindowMinutes must be between ${MIN_PAYMENT_WINDOW_MINUTES} and ${MAX_PAYMENT_WINDOW_MINUTES}`,
    );
  }
}

/**
 * The site's display name, as stored. It heads every ticket, so it is never
 * blank, and the limit keeps one runaway paste off the paper.
 */
export function cleanDisplayName(raw: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0) throw new BadRequestException('Display name cannot be blank');
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new BadRequestException(`Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`);
  }
  return name;
}

/** Optional receipt lines: trimmed; blank clears to null; 1-120 characters. */
export function cleanReceiptLine(raw: string | null, field: string): string | null {
  if (raw === null) return null;
  const line = raw.trim();
  if (line.length === 0) return null;
  if (line.length > 120) throw new BadRequestException(`${field} must be at most 120 characters`);
  return line;
}

/** A required name for a category or gate. */
export function cleanName(raw: string, what: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new BadRequestException(`A ${what} name cannot be blank`);
  if (name.length > 100) throw new BadRequestException(`A ${what} name must be at most 100 characters`);
  return name;
}
