import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { PaystackGateway } from '../paystack/paystack.gateway';
import { amountMatches, paystackPaidAt, windowExpired } from '../paystack/verdicts';
import { LATE_CHECK_MINUTES } from '../jobs/verify-schedule';

/**
 * Everything that moves a CARD payment out of PENDING, and the only place a
 * card payment marks its ticket PAID. Every move is Paystack's answer, from a
 * signed webhook or a verify call; the payment window only decides what an
 * unpaid answer means.
 *
 * Adapted from eparking backend/src/paystack/paystack.service.ts: no
 * UNRESOLVED status (an unknown outcome stays PENDING here); since Sprint R
 * the ticket already exists and SUCCESS marks it PAID in the same
 * transaction.
 *
 * Log lines carry the reference and a reason only: never the payload, card
 * data, the checkout link, the access code or a token.
 */

export type SettleResult = 'settled' | 'duplicate' | 'already' | 'unknown-reference' | 'amount-mismatch';

/** What is kept of Paystack's payload. The reusable card authorization code is dropped. */
function storable(payload: Record<string, unknown>): Prisma.InputJsonValue {
  const copy = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const auth = copy.authorization as Record<string, unknown> | undefined;
  if (auth && typeof auth === 'object') delete auth.authorization_code;
  return copy as Prisma.InputJsonValue;
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly gateway: PaystackGateway,
  ) {}

  /**
   * Paystack says the charge succeeded. Idempotent, keyed on our reference.
   *
   * Lock order, the same as the booth: the TICKET row FOR UPDATE first, then
   * the payment row. Cash and this path for one ticket therefore serialise;
   * two deliveries at the same moment too (the second sees SUCCESS or
   * DUPLICATE and does nothing).
   *
   *   ticket UNPAID            payment SUCCESS, ticket PAID through it
   *   ticket already PAID      payment DUPLICATE (Q1): Paystack's time and
   *                            payload kept, no paid_at, the ticket untouched,
   *                            ERROR DOUBLE_PAYMENT (refund in Paystack)
   *   ticket expired           SUCCESS and PAID all the same (Q2): it stays
   *                            EXPIRED at exit; WARN LATE_SUCCESS_EXPIRED
   *   payment was ABANDONED    accepted (Paystack is the authority);
   *   or FAILED                WARN LATE_SUCCESS
   */
  async settleSuccess(reference: string, data: Record<string, unknown>, source: 'webhook' | 'verify'): Promise<SettleResult> {
    const siteId = await this.site.getId();
    return this.prisma.$transaction(
      async (tx) => {
        const found = await tx.payment.findFirst({ where: { siteId, reference }, select: { id: true, ticketId: true } });
        if (!found) {
          this.logger.warn(`Paystack SUCCESS for unknown reference ${reference} via ${source}; ignored`);
          return 'unknown-reference';
        }
        const [ticket] = await tx.$queryRaw<Array<{ payment_status: string; ticket_number: string; expired: boolean; db_now: Date }>>`
          SELECT payment_status::text AS payment_status, ticket_number, (now() >= valid_until) AS expired, now() AS db_now
            FROM ticket WHERE id = ${found.ticketId}::uuid FOR UPDATE`;
        const [{ status }] = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status::text AS status FROM payment WHERE id = ${found.id}::uuid FOR UPDATE`;
        if (status === 'SUCCESS' || status === 'DUPLICATE') return 'already';

        const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
        if (payment.method !== 'CARD') return 'already';
        if (!amountMatches(payment, data)) {
          this.logger.error(
            `AMOUNT_MISMATCH for ${reference} via ${source}: Paystack's amount or currency is not ` +
              `${payment.amountKobo} kobo NGN. Not settled; the ticket is not paid.`,
          );
          return 'amount-mismatch';
        }

        if (ticket.payment_status === 'PAID') {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'DUPLICATE', paystackPaidAt: paystackPaidAt(data), paystackEvent: storable(data) },
          });
          this.logger.error(
            `DOUBLE_PAYMENT for ${reference} via ${source}: Paystack confirmed a payment for ticket ` +
              `${ticket.ticket_number}, which was already paid. Recorded as DUPLICATE; refund it in the Paystack dashboard.`,
          );
          return 'duplicate';
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'SUCCESS', paidAt: ticket.db_now, paystackPaidAt: paystackPaidAt(data), paystackEvent: storable(data) },
        });
        await tx.ticket.update({
          where: { id: found.ticketId },
          data: { paymentStatus: 'PAID', paidPaymentId: payment.id, paidAt: ticket.db_now },
        });
        if (ticket.expired) {
          this.logger.warn(
            `LATE_SUCCESS_EXPIRED for ${reference} via ${source}: ticket ${ticket.ticket_number} had expired. ` +
              'Recorded and marked PAID; it stays EXPIRED and cannot exit. Nothing is refunded in the app.',
          );
        } else if (status !== 'PENDING') {
          this.logger.warn(
            `LATE_SUCCESS for ${reference} via ${source}: Paystack confirmed a payment marked ${status}. Ticket PAID.`,
          );
        }
        this.logger.log(`Payment ${reference} SUCCESS via ${source}; ticket ${ticket.ticket_number} PAID`);
        return 'settled';
      },
      { timeout: 20_000 },
    );
  }

  /** Paystack says the charge failed. Only a PENDING payment moves; SUCCESS is final. */
  async markFailed(reference: string, data: Record<string, unknown>): Promise<boolean> {
    const siteId = await this.site.getId();
    const { count } = await this.prisma.payment.updateMany({
      where: { siteId, reference, status: 'PENDING' },
      data: { status: 'FAILED', paystackEvent: storable(data) },
    });
    if (count === 1) this.logger.log(`Payment ${reference} FAILED (Paystack)`);
    return count === 1;
  }

  /**
   * Ask Paystack how a PENDING payment stands, and act on the answer:
   *
   *   success                 settle (and issue the ticket)
   *   failed                  FAILED
   *   abandoned / pending     ABANDONED once past the window; else stay PENDING
   *   not found               ABANDONED at once if Paystack never gave us a
   *                           checkout; else as abandoned
   *   unknown (no answer)     nothing, whatever the window says
   */
  async verifyAndApply(reference: string): Promise<void> {
    const siteId = await this.site.getId();
    const payment = await this.prisma.payment.findFirst({ where: { siteId, reference } });
    if (!payment || payment.status !== 'PENDING') return;

    const answer = await this.gateway.verify(reference);
    if (answer.kind === 'success' && answer.data) {
      await this.settleSuccess(reference, answer.data, 'verify');
      return;
    }
    if (answer.kind === 'failed') {
      await this.markFailed(reference, answer.data ?? {});
      return;
    }
    if (answer.kind === 'unknown') return;

    if (answer.kind === 'not_found' && payment.authorizationUrl === null) {
      await this.abandon(payment.id, reference, 'Paystack has no such transaction');
      return;
    }

    const setting = await this.prisma.siteSetting.findUniqueOrThrow({
      where: { siteId },
      select: { paymentWindowMinutes: true },
    });
    if (windowExpired(payment.createdAt, new Date(), setting.paymentWindowMinutes)) {
      await this.abandon(payment.id, reference, `not paid within ${setting.paymentWindowMinutes} minutes`);
    }
  }

  /**
   * T8: a CARD payment that already ENDED (ABANDONED or FAILED), asked again
   * within LATE_CHECK_MINUTES of ending (its updated_at, on the database
   * clock: every status change writes it, and nothing else touches an ended
   * payment). Only Paystack's SUCCESS changes anything, through the unchanged
   * settleSuccess: LATE_SUCCESS (ticket PAID), or DUPLICATE when the ticket was
   * paid meanwhile (by cash). Any other answer, or none, changes nothing.
   */
  async verifyEnded(reference: string): Promise<void> {
    const siteId = await this.site.getId();
    const [found] = await this.prisma.$queryRaw<Array<{ recent: boolean }>>`
      SELECT updated_at >= now() - make_interval(mins => ${LATE_CHECK_MINUTES}::int) AS recent
        FROM payment
       WHERE site_id = ${siteId}::uuid AND reference = ${reference}
         AND method = 'CARD' AND status IN ('ABANDONED', 'FAILED')`;
    if (!found || !found.recent) return;

    const answer = await this.gateway.verify(reference);
    if (answer.kind === 'success' && answer.data) {
      await this.settleSuccess(reference, answer.data, 'verify');
    }
  }

  /** PENDING -> ABANDONED. A later Paystack SUCCESS can still settle it. */
  async abandon(paymentId: string, reference: string, reason: string): Promise<void> {
    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'ABANDONED' },
    });
    if (count === 1) this.logger.log(`Payment ${reference} ABANDONED: ${reason}`);
  }
}
