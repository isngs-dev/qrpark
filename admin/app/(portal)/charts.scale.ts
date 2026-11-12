/**
 * The Finance charts' scale marks (UI-1). Pure; tested in
 * tests/charts-scale.test.ts. Written new.
 *
 * THE ONE EXCEPTION to "no money is computed in the portal", and a narrow
 * one: an axis mark is a rounded "nice" number on a chart's scale, never a
 * figure. Every amount a reader is told comes from the backend as it came.
 * Only charts.tsx imports this file (source-scan.test.ts).
 */

/** Steps of 1, 2, 2.5 or 5 x 10^n, whole numbers only. */
function niceStep(atLeast: number, minStep: number): number {
  const want = Math.max(atLeast, minStep);
  for (let p = 1; ; p *= 10) {
    for (const f of [1, 2, 2.5, 5]) {
      const step = f * p;
      if (Number.isInteger(step) && step >= want) return step;
    }
  }
}

/** A scale from 0 with at most [ticks] steps whose top is at or above [max]; an empty chart gets the smallest step. */
export function niceScale(max: number, ticks: number, minStep: number): { top: number; step: number; marks: number[] } {
  const step = niceStep(max / ticks, minStep);
  const top = max === 0 ? step * ticks : Math.ceil(max / step) * step;
  const marks: number[] = [];
  for (let m = 0; m <= top; m += step) marks.push(m);
  return { top, step, marks };
}

/** "1.5" from [n] in [unit]s, one decimal, by integers; "2" when whole. */
function short(n: number, unit: number): string {
  const whole = Math.floor(n / unit);
  const tenth = Math.floor(((n % unit) * 10) / unit);
  return tenth === 0 ? String(whole) : `${whole}.${tenth}`;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${short(n, 1_000_000_000)}b`;
  if (n >= 1_000_000) return `${short(n, 1_000_000)}m`;
  if (n >= 1_000) return `${short(n, 1_000)}k`;
  return String(n);
}

/** A money mark from kobo: "₦0", "₦500", "₦2.5k", "₦1.5m". Marks are whole naira. */
export const scaleLabel = (kobo: number) => `₦${compact(Math.floor(kobo / 100))}`;

/** A count mark: "25", "1.5k". */
export const countLabel = (n: number) => compact(n);

/** Which of [n] x-axis labels to show: at most about [max], always the first and the last. */
export function thinTicks(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max) return [...Array(n).keys()];
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  if (n - 1 - out[out.length - 1] < step / 2) out.pop();
  out.push(n - 1);
  return out;
}

/** A bar's height in pixels: [value] against the scale's [top], over [px]. Above zero is at least 1px. */
export function heightOf(value: number, top: number, px: number): number {
  if (value <= 0 || top <= 0) return 0;
  return Math.max(1, (value / top) * px);
}
