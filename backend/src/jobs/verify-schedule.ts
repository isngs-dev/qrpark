/**
 * When the delayed Paystack checks run after a payment starts (tested in
 * verify-schedule.test.ts).
 *
 * Without a webhook (none is public yet), the single 20 s check left a
 * customer who finished paying at 25 s waiting up to 2 minutes for the sweep.
 * So the checkout gets several checks, ONLY inside the payment window: after
 * it, the sweep takes over. Each is an ordinary verify job, so each one moves
 * a payment only on Paystack's answer (SettlementService.verifyAndApply),
 * never on the timer that fired it.
 */

/** After an accepted checkout: about 20 s, then spaced out over the window. */
export const CHECKOUT_VERIFY_DELAYS_MS = [20_000, 45_000, 90_000, 150_000, 240_000];

/**
 * T8 (Sprint 4b fix): a CARD payment that ended ABANDONED or FAILED (a cancel
 * at the booth, the window, Paystack's failure) is still verified for this
 * long after it ended, by the delayed checks and the sweep: the customer may
 * still finish Paystack's checkout, and while the webhook cannot reach the
 * backend (T6) a verify is the only way that money is seen. Only Paystack's
 * SUCCESS changes anything (settlement: LATE_SUCCESS, or DUPLICATE).
 */
export const LATE_CHECK_MINUTES = 30;

/** When Paystack did not answer the start: ask within seconds first. */
export const UNKNOWN_START_VERIFY_MS = 3_000;

export function verifyDelays(outcome: 'accepted' | 'unknown', windowMinutes: number): number[] {
  const windowMs = windowMinutes * 60_000;
  const delays = outcome === 'unknown' ? [UNKNOWN_START_VERIFY_MS, ...CHECKOUT_VERIFY_DELAYS_MS] : CHECKOUT_VERIFY_DELAYS_MS;
  return delays.filter((delay) => delay < windowMs);
}
