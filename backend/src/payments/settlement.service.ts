import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { PaystackGateway } from '../paystack/paystack.gateway';
import { amountMatches, paystackPaidAt, windowExpired } from '../paystack/verdicts';
import { TicketIssuer } from '../tickets/ticket-issuer';

/**
 * Everything that moves a payment out of PENDING, and the only place a
 * ticket is issued. Every move is Paystack's answer, from a signed webhook or
 * a verify call; the payment window only decides what an unpaid answer means.
 *
 * Adapted from eparking backend/src/paystack/paystack.service.ts: no
 * UNRESOLVED status (an unknown outcome stays PENDING here), no double-charge
 * path, and the ticket issued in the same transaction as SUCCESS.
 *
 * Log lines carry the reference and a reason only: never the payload, card
 * data, the checkout link, the access code or a token.
 */

export type SettleResult = 'settled' | 'already' | 'unknown-reference' | 'amount-mismatch';

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
    private readonly issuer: TicketIssuer,
  ) {}

  /**
   * Paystack says the charge succeeded. Idempotent, keyed on our reference.
   *
   * The payment row is locked FOR UPDATE, so two deliveries at the same
   * moment are serialised: the second sees SUCCESS and does nothing. The
   * SUCCESS update and the ticket insert commit together or not at all.
   *
   * A late SUCCESS (the payment was ABANDONED or FAILED) is accepted:
   * Paystack is the authority and the customer has paid.
   */
  async settleSuccess(reference: string, data: Record<string, unknown>, source: 'webhook' | 'verify'): Promise<SettleResult> {
    const siteId = await this.site.getId();
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id::text, status::text FROM payment
          WHERE reference = ${reference} AND site_id = ${siteId}::uuid
          FOR UPDATE`;
        if (rows.length === 0) {
          this.logger.warn(`Paystack SUCCESS for unknown reference ${reference} via ${source}; ignored`);
          return 'unknown-reference';
        }
        const { id, status } = rows[0];
        if (status === 'SUCCESS') return 'already';

        const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
        if (!amountMatches(payment, data)) {
          this.logger.error(
            `AMOUNT_MISMATCH for ${reference} via ${source}: Paystack's amount or currency is not ` +
              `${payment.amountKobo} kobo NGN. Not settled; no ticket issued.`,
          );
          return 'amount-mismatch';
        }
        if (status !== 'PENDING') {
          this.logger.warn(
            `LATE_SUCCESS for ${reference} via ${source}: Paystack confirmed a payment marked ${status}. ` +
              'Ticket issued. If the customer also paid a second time, refund one in the Paystack dashboard.',
          );
        }

        const paidAt = new Date();
        await tx.payment.update({
          where: { id },
          data: { status: 'SUCCESS', paidAt, paystackPaidAt: paystackPaidAt(data), paystackEvent: storable(data) },
        });
        const ticket = await this.issuer.issue(tx, payment, paidAt);
        this.logger.log(`Payment ${reference} SUCCESS via ${source}; ticket ${ticket.ticketNumber} issued`);
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

  /** PENDING -> ABANDONED. A later Paystack SUCCESS can still settle it. */
  async abandon(paymentId: string, reference: string, reason: string): Promise<void> {
    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'ABANDONED' },
    });
    if (count === 1) this.logger.log(`Payment ${reference} ABANDONED: ${reason}`);
  }
}
