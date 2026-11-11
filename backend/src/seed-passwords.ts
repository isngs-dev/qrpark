import { MIN_PASSWORD_LENGTH } from './users/user-rules';

/**
 * Sprint 6a: the seeds take every password from the server's .env (SEED_*
 * variables, deleted from .env once seeding is done) and print none. Written
 * new; tested in seed-test-data.rules.test.ts.
 *
 * A password is refused when it is missing, holds a character the .env file
 * cannot keep as typed ($ # ' " ` \ or whitespace), is shorter than the
 * portal's minimum (12), or is obviously weak: on the list below (case ignored), one character
 * repeated, a straight run of letters or digits, or containing the username,
 * "password", "qrpark", "garki" or "admin". The reason never quotes the value.
 */

/** Common choices that pass a length rule. Compared without case. */
export const WEAK_PASSWORDS: readonly string[] = [
  'password1234',
  'password12345',
  'passw0rd1234',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwerty123456',
  '1q2w3e4r5t6y',
  'administrator',
  'changeme1234',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'abcdefghijkl',
];

const WEAK_PARTS = ['password', 'qrpark', 'garki', 'admin'];

/**
 * Characters the server's .env cannot hold as typed: Docker Compose reads $
 * as a variable and # as a comment, and quotes, backslash and whitespace
 * change the value. A password containing one would be saved mangled and the
 * account could not sign in, so it is refused before anything is written.
 */
const UNSAFE_IN_ENV_FILE = /[$#'"`\\\s]/;

/** A straight run (abcd..., 1234..., or backwards) over the whole value. */
function isStraightRun(v: string): boolean {
  const deltas = new Set<number>();
  for (let i = 1; i < v.length; i++) deltas.add(v.charCodeAt(i) - v.charCodeAt(i - 1));
  return deltas.size === 1 && (deltas.has(1) || deltas.has(-1));
}

/** Why [value] may not be the password for [username] (named [variable]), or null. */
export function seedPasswordProblem(variable: string, value: string | undefined, username: string): string | null {
  if (value === undefined || value === '') return `${variable} is not set. Put it in the server's .env for this run.`;
  if (UNSAFE_IN_ENV_FILE.test(value)) {
    return `${variable} contains a character the server's .env cannot hold safely ($ # ' " \` \\ or a space). Choose a password without them.`;
  }
  if (value.length < MIN_PASSWORD_LENGTH) return `${variable} is too short: at least ${MIN_PASSWORD_LENGTH} characters.`;
  const lower = value.toLowerCase();
  const weak =
    WEAK_PASSWORDS.includes(lower) ||
    new Set(lower).size === 1 ||
    isStraightRun(lower) ||
    WEAK_PARTS.some((part) => lower.includes(part)) ||
    (username.length > 0 && lower.includes(username.toLowerCase()));
  return weak ? `${variable} is too weak (a common choice, a repeat or run, or it contains the name). Choose another.` : null;
}

/** Throws with the reason when [value] is not a usable seed password. */
export function assertSeedPassword(variable: string, value: string | undefined, username: string): asserts value is string {
  const problem = seedPasswordProblem(variable, value, username);
  if (problem) throw new Error(problem);
}
