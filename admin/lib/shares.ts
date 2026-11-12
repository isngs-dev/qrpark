/**
 * Shares of a total and bar lengths (UI-1, P1 and P3). Pure; tested in
 * tests/shares.test.ts. Written new.
 *
 * DISPLAY ONLY. The inputs are the backend's integer kobo; what comes out is a
 * percentage or a bar length, never an amount, and nothing here is ever
 * formatted as naira. Integer (BigInt) arithmetic throughout, so very large
 * totals stay exact.
 */

function whole(values: number[]): bigint[] {
  for (const v of values) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error('shares are of non-negative whole kobo');
  }
  return values.map(BigInt);
}

/**
 * Each part's share of their sum in tenths of a percent, adding up to exactly
 * 1000 (100.0%): floors first, then the tenths left over go to the largest
 * remainders (ties to the earlier part). Null for every part when the sum is 0.
 */
export function shares(parts: number[]): Array<number | null> {
  const p = whole(parts);
  const sum = p.reduce((a, x) => a + x, 0n);
  if (sum === 0n) return parts.map(() => null);
  const floors = p.map((x) => (x * 1000n) / sum);
  const rests = p.map((x, i) => ({ i, rest: (x * 1000n) % sum }));
  let left = 1000n - floors.reduce((a, x) => a + x, 0n);
  for (const { i } of rests.sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1))) {
    if (left === 0n) break;
    floors[i] += 1n;
    left -= 1n;
  }
  return floors.map(Number);
}

/**
 * The shares as text with one decimal. A part that is neither none nor all of
 * the sum never reads "0%" or "100%": it reads "<0.1%" or ">99.9%".
 */
export function shareLabels(parts: number[]): string[] {
  const tenths = shares(parts);
  const sum = whole(parts).reduce((a, x) => a + x, 0n);
  return tenths.map((t, i) => {
    if (t === null) return '–';
    const part = BigInt(parts[i]);
    if (part === 0n) return '0%';
    if (part === sum) return '100%';
    if (t === 0) return '<0.1%';
    if (t === 1000) return '>99.9%';
    return `${Math.floor(t / 10)}.${t % 10}%`;
  });
}

/**
 * Each value's bar length as a percentage of the largest, to one decimal.
 * Anything above zero gets at least 0.1, so it never vanishes.
 */
export function barWidths(values: number[]): number[] {
  const v = whole(values);
  const max = v.reduce((a, x) => (x > a ? x : a), 0n);
  if (max === 0n) return values.map(() => 0);
  return v.map((x) => {
    if (x === 0n) return 0;
    const tenths = Number((x * 1000n) / max);
    return Math.max(tenths, 1) / 10;
  });
}

/**
 * UI-1: the change from [previous] to [current] (whole numbers: kobo or a
 * count) as a percentage to one decimal, rounded half away from zero. "new"
 * when there was nothing before; a change too small to show is "+<0.1%" or
 * "−<0.1%", never a false "0.0%".
 */
export function changeLabel(current: number, previous: number): string {
  const [c, p] = whole([current, previous]);
  if (p === 0n) return c === 0n ? '–' : 'new';
  const diff = c - p;
  const neg = diff < 0n;
  const abs = neg ? -diff : diff;
  const tenths = (abs * 2000n + p) / (2n * p); // |diff| / p in tenths of a percent, half away from zero
  const sign = diff === 0n ? '' : neg ? '−' : '+';
  if (diff !== 0n && tenths === 0n) return `${sign}<0.1%`;
  return `${sign}${tenths / 10n}.${tenths % 10n}%`;
}
