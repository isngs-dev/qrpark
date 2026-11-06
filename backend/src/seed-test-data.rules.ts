import { randomInt } from 'node:crypto';
import type { GateDirection, UserRole } from '@prisma/client';

/**
 * What `node dist/seed-test-data.js` creates on a TEST site, and the guard
 * that stops it touching any other. Pure, so both are tested without a
 * database.
 *
 * Copied from eparking backend/src/seed-test-data.rules.ts and adapted: flat
 * prices, two gates, one entry and one exit operator, no passes.
 *
 * EVERY AMOUNT HERE IS A TEST VALUE. Garki's real categories and prices are
 * an open question (CLAUDE.md). The figures are eparking's test first-hour
 * values, so the two test sites look alike.
 */

/** Only a site whose code ends in this may be seeded. */
export const TEST_SITE_SUFFIX = '-test';

/** Why this site may not be seeded, or null if it may. */
export function testSiteProblem(siteCode: string | undefined): string | null {
  const shown = siteCode === undefined ? '(not set)' : `"${siteCode}"`;
  // Case-sensitive and exact: "garki-TEST", "garki-testing" and a trailing
  // space are all refused.
  if (siteCode === undefined || !siteCode.endsWith(TEST_SITE_SUFFIX) || siteCode.length <= TEST_SITE_SUFFIX.length) {
    return `Refused: SITE_CODE is ${shown}. This script only seeds a test site whose code ends in "${TEST_SITE_SUFFIX}", so it can never touch a real site.`;
  }
  return null;
}

export const TEST_GATES: ReadonlyArray<{ code: string; name: string; direction: GateDirection }> = [
  { code: 'ENTRY_1', name: 'Test entry 1', direction: 'ENTRY' },
  { code: 'EXIT_1', name: 'Test exit 1', direction: 'EXIT' },
];

/** TEST VALUES, integer kobo, flat per vehicle. */
export const TEST_CATEGORIES: ReadonlyArray<{ code: string; name: string; priceKobo: number }> = [
  { code: 'CAR', name: 'Car', priceKobo: 50_000 },
  { code: 'SUV', name: 'SUV', priceKobo: 50_000 },
  { code: 'BIKE', name: 'Bike', priceKobo: 20_000 },
  { code: 'VAN', name: 'Van', priceKobo: 70_000 },
  { code: 'TRUCK', name: 'Truck', priceKobo: 100_000 },
  { code: 'LORRY', name: 'Lorry', priceKobo: 120_000 },
];

/** Neutral names: an account never says who it was given to. */
export const TEST_ACCOUNTS: ReadonlyArray<{ username: string; name: string; role: UserRole; gateCode: string }> = [
  { username: 'entry-1', name: 'Test entry operator 1', role: 'ENTRY_OPERATOR', gateCode: 'ENTRY_1' },
  { username: 'exit-1', name: 'Test exit operator 1', role: 'EXIT_OPERATOR', gateCode: 'EXIT_1' },
];

/** No 0/O, 1/l/I: a password is read off a screen and typed on a phone. */
export const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export const PASSWORD_LENGTH = 16;

/** `pick` must be a cryptographic source in real use; randomInt is. */
export function generatePassword(pick: (max: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) out += PASSWORD_ALPHABET[pick(PASSWORD_ALPHABET.length)];
  return out;
}

/** Display only: integer kobo as naira for the console, e.g. NGN 1,200.00. */
export function naira(kobo: number): string {
  const whole = Math.floor(kobo / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `NGN ${whole}.${String(kobo % 100).padStart(2, '0')}`;
}
