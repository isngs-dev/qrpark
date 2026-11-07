import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Payment, type Ticket } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { LockService } from '../lock/lock.service';
import { PaystackGateway } from '../paystack/paystack.gateway';
import { windowExpired } from '../paystack/verdicts';
import { ReconciliationService } from '../jobs/reconciliation.service';
import { verifyDelays } from '../jobs/verify-schedule';
import { assertCategoryInUse } from '../config/category-in-use';
import { assertGateAcceptsEntry, assertGateInService } from '../config/gate-in-service';
import { newPaymentReference } from '../tickets/ticket-codes';
import { ticketView } from '../tickets/ticket-view';
import { payerEmail } from './payer-email';
import { cleanCustomerName, replayVerdict } from './idempotency';
import { SettlementService } from './settlement.service';
import type { Actor } from '../auth/auth.guard';

/**
 * Taking a payment. Adapted from eparking backend/src/payments/payments.service.ts
 * (the lock, the unwind by what we KNOW), rewritten around a ticket instead
 * of a visit.
 *
 * Three layers stop a customer being charged twice:
 *   1. The idempotency key: a repeated tap gets the same payment back.
 *   2. The Redis lock per operator: two requests cannot both decide to charge.
 *   3. payment_one_pending_per_operator: the database never holds two.
 *
 * The amount is the category's price at this moment, copied onto the
 * payment. The app sends a category code, never a price.
 */

/** Long enough to cover the Paystack call and a verify; short enough to free itself. */
const LOCK_TTL_MS = 90_000;

export interface StartInput {
  categoryCode: string;
  customerName?: string | null;
  idempotencyKey: string;
}

type PaymentWithTicket = Payment & { ticket: (Ticket & { gate: { code: string; name: string }; operator: { name: string } }) | null };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly lock: LockService,
    private readonly gateway: PaystackGateway,
    private readonly settlement: SettlementService,
    private readonly jobs: ReconciliationService,
  ) {}

  /** Active categories with their backend price, for the entry screen. */
  async categories() {
    const siteId = await this.site.getId();
    return this.prisma.vehicleCategory.findMany({
      where: { siteId, isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true, priceKobo: true },
    });
  }

  /** Returns the payment view and whether it was newly created. */
  async start(actor: Actor, input: StartInput): Promise<{ created: boolean; payment: ReturnType<PaymentsService['view']> }> {
    const siteId = await this.site.getId();
    if (!this.gateway.isConfigured()) {
      throw new ServiceUnavailableException('Payments are not configured on this server.');
    }

    const categoryCode = input.categoryCode.trim().toUpperCase();
    const customerName = cleanCustomerName(input.customerName);
    const request = { operatorId: actor.id, categoryCode, customerName };

    const gate = actor.gateId
      ? await this.prisma.gate.findFirst({ where: { id: actor.gateId, siteId } })
      : null;
    assertGateInService(gate);
    assertGateAcceptsEntry(gate!);

    const replay = await this.replay(siteId, input.idempotencyKey, request);
    if (replay) return { created: false, payment: replay };

    return this.lock.withLock(
      `payment:operator:${actor.id}`,
      LOCK_TTL_MS,
      async () => {
        // Again inside the lock: another request may have got there first.
        const raced = await this.replay(siteId, input.idempotencyKey, request);
        if (raced) return { created: false, payment: raced };

        await this.refusePending(siteId, actor.id);

        const category = await this.prisma.vehicleCategory.findUnique({
          where: { siteId_code: { siteId, code: categoryCode } },
        });
        assertCategoryInUse(categoryCode, category);

        let payment: Payment;
        try {
          payment = await this.prisma.payment.create({
            data: {
              siteId,
              reference: newPaymentReference(),
              idempotencyKey: input.idempotencyKey,
              operatorId: actor.id,
              gateId: gate!.id,
              categoryId: category.id,
              categoryCode: category.code,
              categoryName: category.name,
              amountKobo: category.priceKobo,
              customerName,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const again = await this.replay(siteId, input.idempotencyKey, request);
            if (again) return { created: false, payment: again };
            throw new ConflictException('A payment is already in progress for you.');
          }
          throw error;
        }

        // The row exists before the customer can pay, so a webhook that
        // arrives first still finds it.
        const result = await this.gateway.initialize({
          reference: payment.reference,
          amountKobo: payment.amountKobo,
          email: payerEmail(null),
        });

        if (result.outcome === 'refused') {
          // A clear "no": no charge exists and none can appear.
          await this.settlement.abandon(payment.id, payment.reference, 'Paystack refused to start it');
          throw new BadGatewayException({
            statusCode: 502,
            message: 'Paystack refused to start this payment. Try again; if it repeats, tell the administrator.',
            paymentId: payment.id,
          });
        }
        if (result.outcome === 'unknown') {
          // Paystack MAY have it. It stays PENDING (blocking a second charge)
          // and is checked within seconds.
          await this.scheduleChecks(siteId, payment.reference, 'unknown');
          throw new ServiceUnavailableException({
            statusCode: 503,
            message: 'Paystack did not answer. Do not take payment again; this one is being checked.',
            outcome: 'unknown',
            paymentId: payment.id,
          });
        }

        const saved = await this.prisma.payment.update({
          where: { id: payment.id },
          data: { authorizationUrl: result.authorizationUrl, accessCode: result.accessCode },
        });
        await this.scheduleChecks(siteId, saved.reference, 'accepted');
        return { created: true, payment: this.view({ ...saved, ticket: null }, null) };
      },
      'take this payment',
    );
  }

  /** The operator's own payment, with its ticket once issued. Anyone else: 404. */
  async get(actor: Actor, id: string) {
    const siteId = await this.site.getId();
    const payment = await this.prisma.payment.findFirst({
      where: { id, siteId, operatorId: actor.id },
      include: { ticket: { include: { gate: { select: { code: true, name: true } }, operator: { select: { name: true } } } } },
    });
    if (!payment) throw new NotFoundException('Unknown payment');
    const header = payment.ticket ? await this.header(siteId) : null;
    return this.view(payment, header);
  }

  /** An existing payment for this key, or null. Throws 409 for a key that is not this request's. */
  private async replay(siteId: string, idempotencyKey: string, request: Parameters<typeof replayVerdict>[1]) {
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { ticket: { include: { gate: { select: { code: true, name: true } }, operator: { select: { name: true } } } } },
    });
    if (!existing) return null;
    const verdict = existing.siteId === siteId ? replayVerdict(existing, request) : 'OTHER_OPERATOR';
    if (verdict === 'OTHER_OPERATOR') throw new ConflictException('This idempotency key has already been used.');
    if (verdict === 'DIFFERENT_REQUEST') {
      throw new ConflictException('This idempotency key was used for a different payment. Start a new attempt.');
    }
    return this.view(existing, existing.ticket ? await this.header(siteId) : null);
  }

  /**
   * One payment in progress per operator. A PENDING one past the window is
   * checked with Paystack first: it may have been paid (then it settles and
   * gets its ticket) or not (then it is ABANDONED and stops blocking).
   */
  private async refusePending(siteId: string, operatorId: string) {
    const pending = await this.prisma.payment.findFirst({ where: { siteId, operatorId, status: 'PENDING' } });
    if (!pending) return;
    const { paymentWindowMinutes } = await this.prisma.siteSetting.findUniqueOrThrow({
      where: { siteId },
      select: { paymentWindowMinutes: true },
    });
    if (windowExpired(pending.createdAt, new Date(), paymentWindowMinutes)) {
      await this.settlement.verifyAndApply(pending.reference);
      const now = await this.prisma.payment.findUniqueOrThrow({ where: { id: pending.id }, select: { status: true } });
      if (now.status !== 'PENDING') return;
    }
    throw new ConflictException({
      statusCode: 409,
      message: 'A payment is already in progress. Finish it or wait for it to be confirmed.',
      pendingPaymentId: pending.id,
    });
  }

  /**
   * The delayed Paystack checks for a payment that may be in the customer's
   * hands, all inside the site's payment window (verify-schedule.ts). The
   * sweep covers anything after it.
   */
  private async scheduleChecks(siteId: string, reference: string, outcome: 'accepted' | 'unknown') {
    const { paymentWindowMinutes } = await this.prisma.siteSetting.findUniqueOrThrow({
      where: { siteId },
      select: { paymentWindowMinutes: true },
    });
    for (const delay of verifyDelays(outcome, paymentWindowMinutes)) {
      await this.jobs.scheduleVerify(reference, delay);
    }
  }

  private async header(siteId: string) {
    return this.prisma.siteSetting.findUniqueOrThrow({
      where: { siteId },
      select: { displayName: true, receiptOrgName: true, receiptContactLine: true },
    });
  }

  view(payment: PaymentWithTicket | (Payment & { ticket: null }), header: Parameters<typeof ticketView>[1] | null) {
    const pending = payment.status === 'PENDING';
    return {
      id: payment.id,
      reference: payment.reference,
      status: payment.status,
      categoryCode: payment.categoryCode,
      categoryName: payment.categoryName,
      amountKobo: payment.amountKobo,
      customerName: payment.customerName,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      // The checkout only while there is something to pay on it.
      authorizationUrl: pending ? payment.authorizationUrl : null,
      accessCode: pending ? payment.accessCode : null,
      ticket: payment.ticket && header ? ticketView(payment.ticket, header) : null,
    };
  }
}
