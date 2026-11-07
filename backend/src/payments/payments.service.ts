import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { AuditService } from '../audit/audit.service';
import { LockService } from '../lock/lock.service';
import { PaystackGateway } from '../paystack/paystack.gateway';
import { windowExpired } from '../paystack/verdicts';
import { ReconciliationService } from '../jobs/reconciliation.service';
import { verifyDelays } from '../jobs/verify-schedule';
import { locationFor } from '../config/gate-in-service';
import { TOKEN_PATTERN, newPaymentReference } from '../tickets/ticket-codes';
import { isUniqueViolation } from '../tickets/ticket-issuer';
import { loadSummary, type TicketSummary } from '../tickets/ticket-view';
import { payerEmail } from './payer-email';
import { replayVerdict } from './idempotency';
import { SettlementService } from './settlement.service';
import type { Actor } from '../auth/auth.guard';

/**
 * The payment booth: cash and card against an existing ticket. docs/api.md,
 * "Booth". The card flow is adapted from eparking
 * backend/src/payments/payments.service.ts (the lock, the unwind by what we
 * KNOW), as in Sprint 2, now against a ticket.
 *
 * The amount is ALWAYS the ticket's fee snapshot; nothing about money comes
 * from the client. The database backs it (payment_ticket_fee_fkey).
 *
 * Every write locks the ticket row FOR UPDATE first, then reads or writes its
 * payments: the same order as settlement, so cash and a card SUCCESS for one
 * ticket serialise on the ticket and cannot deadlock. Expiry is read on the
 * database clock under that lock.
 *
 * No double payment:
 *   1. The idempotency key: a repeated tap gets the same payment back.
 *   2. The ticket lock and the checks under it (paid, used, expired, a card
 *      in progress).
 *   3. The database: one SUCCESS and one PENDING per ticket, one PENDING per
 *      operator (partial unique indexes).
 *   Card also takes the per-operator Redis lock (fails closed).
 */

/** Long enough to cover the Paystack call and a verify; short enough to free itself. */
const LOCK_TTL_MS = 90_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BoothInput {
  token?: string;
  ticketId?: string;
  idempotencyKey: string;
}

type Db = PrismaService | Prisma.TransactionClient;
type Method = 'CASH' | 'CARD';

interface LockedTicket {
  payment_status: 'UNPAID' | 'PAID';
  validation_status: 'NOT_VALIDATED' | 'VALIDATED';
  fee_kobo: number;
  ticket_number: string;
  expired: boolean;
  db_now: Date;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly audit: AuditService,
    private readonly lock: LockService,
    private readonly gateway: PaystackGateway,
    private readonly settlement: SettlementService,
    private readonly jobs: ReconciliationService,
  ) {}

  // ------------------------------------------------------------------ cash

  /**
   * "Confirm ₦N cash received": one transaction records the cash and marks
   * the ticket PAID, audited. The tap is the confirmation.
   */
  async cash(actor: Actor, input: BoothInput, deviceRef: string) {
    const siteId = await this.site.getId();
    const gate = await locationFor(this.prisma, actor, siteId, 'BOOTH');
    const ticketId = await this.resolveTicket(siteId, input);
    const request = { operatorId: actor.id, subject: subjectOf(ticketId, 'CASH') };

    const replay = await this.replay(this.prisma, siteId, input.idempotencyKey, request);
    if (replay) return { created: false, payment: replay };

    let outcome: { created: boolean; payment: Awaited<ReturnType<PaymentsService['view']>>; ticketNumber?: string; reference?: string };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          const ticket = await this.lockTicket(tx, ticketId);
          // Again under the lock: a tap with the same key may have just committed.
          const raced = await this.replay(tx, siteId, input.idempotencyKey, request);
          if (raced) return { created: false, payment: raced };
          refuse(ticket);
          await this.refusePendingCardOf(tx, ticketId);

          const payment = await tx.payment.create({
            data: {
              siteId,
              ticketId,
              amountKobo: ticket.fee_kobo,
              method: 'CASH',
              status: 'SUCCESS',
              reference: newPaymentReference(),
              idempotencyKey: input.idempotencyKey,
              operatorId: actor.id,
              gateId: gate.id,
              deviceRef,
              paidAt: ticket.db_now,
            },
          });
          await tx.ticket.update({
            where: { id: ticketId },
            data: { paymentStatus: 'PAID', paidPaymentId: payment.id, paidAt: ticket.db_now },
          });
          await this.audit.record({
            client: tx,
            actorId: actor.id,
            action: 'PAYMENT_CASH_CONFIRMED',
            targetType: 'payment',
            targetId: payment.id,
            detail: { ticketNumber: ticket.ticket_number, amountKobo: payment.amountKobo, reference: payment.reference },
          });
          return {
            created: true,
            payment: await this.view(tx, payment),
            ticketNumber: ticket.ticket_number,
            reference: payment.reference,
          };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The key was taken meanwhile (for this request: replay; otherwise 409),
      // or the ticket got a SUCCESS payment through a path that does not lock.
      const again = await this.replay(this.prisma, siteId, input.idempotencyKey, request);
      if (again) return { created: false, payment: again };
      throw new ConflictException('This ticket cannot take this payment now. Scan it again.');
    }
    if (outcome.created) {
      this.logger.log(`CASH payment ${outcome.reference} for ticket ${outcome.ticketNumber} at ${gate.code} by ${actor.id}`);
    }
    return { created: outcome.created, payment: outcome.payment };
  }

  // ------------------------------------------------------------------ card

  /** Starts a Paystack checkout for the ticket's fee. Returns the payment view and whether it is new. */
  async startCard(actor: Actor, input: BoothInput, deviceRef: string) {
    const siteId = await this.site.getId();
    if (!this.gateway.isConfigured()) {
      throw new ServiceUnavailableException('Payments are not configured on this server.');
    }
    const gate = await locationFor(this.prisma, actor, siteId, 'BOOTH');
    const ticketId = await this.resolveTicket(siteId, input);
    const request = { operatorId: actor.id, subject: subjectOf(ticketId, 'CARD') };

    const replay = await this.replay(this.prisma, siteId, input.idempotencyKey, request);
    if (replay) return { created: false, payment: replay };

    return this.lock.withLock(
      `payment:operator:${actor.id}`,
      LOCK_TTL_MS,
      async () => {
        const raced = await this.replay(this.prisma, siteId, input.idempotencyKey, request);
        if (raced) return { created: false, payment: raced };

        // A PENDING one past the window is checked with Paystack first: it may
        // have been paid (then it settles and the ticket is PAID) or not (then
        // it is ABANDONED and stops blocking).
        await this.refuseLivePending(siteId, { operatorId: actor.id });
        await this.refuseLivePending(siteId, { ticketId });

        let payment: Payment;
        try {
          payment = await this.prisma.$transaction(
            async (tx) => {
              const ticket = await this.lockTicket(tx, ticketId);
              refuse(ticket);
              await this.refusePendingCardOf(tx, ticketId);
              return tx.payment.create({
                data: {
                  siteId,
                  ticketId,
                  amountKobo: ticket.fee_kobo,
                  method: 'CARD',
                  status: 'PENDING',
                  reference: newPaymentReference(),
                  idempotencyKey: input.idempotencyKey,
                  operatorId: actor.id,
                  gateId: gate.id,
                  deviceRef,
                },
              });
            },
            { timeout: 15_000 },
          );
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const again = await this.replay(this.prisma, siteId, input.idempotencyKey, request);
          if (again) return { created: false, payment: again };
          const pending = await this.prisma.payment.findFirst({
            where: { siteId, status: 'PENDING', OR: [{ ticketId }, { operatorId: actor.id }] },
            select: { id: true },
          });
          throw new ConflictException({
            statusCode: 409,
            message: 'A card payment for this ticket is in progress',
            pendingPaymentId: pending?.id ?? null,
          });
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
        this.logger.log(`Paystack checkout ${saved.reference} started at ${gate.code} by ${actor.id}`);
        return { created: true, payment: await this.view(this.prisma, saved) };
      },
      'take this payment',
    );
  }

  /** The operator's own payment, with its ticket summary. Anyone else's, or a malformed id: 404. */
  async get(actor: Actor, id: string) {
    const siteId = await this.site.getId();
    const payment = UUID.test(id) ? await this.prisma.payment.findFirst({ where: { id, siteId, operatorId: actor.id } }) : null;
    if (!payment) throw new NotFoundException('Unknown payment');
    return this.view(this.prisma, payment);
  }

  // ---------------------------------------------------------------- cancel

  /**
   * "Cancel payment" at the booth (closes T7). The operator's own PENDING
   * card payment, at least CANCEL_AFTER_SECONDS after it started (database
   * clock). Paystack is asked once, outside any lock:
   *   paid          -> settled as normal; "already paid", nothing cancelled
   *   failed        -> FAILED
   *   not paid, or no such transaction -> ABANDONED, the ticket untouched
   *   no answer     -> 503 "cannot be confirmed", unless force: then ABANDONED
   * force counts only when Paystack could not be reached.
   *
   * The write locks the ticket row, then the payment (the order everywhere),
   * and re-reads the payment there: a webhook that settled it meanwhile wins
   * and nothing is cancelled. A Paystack SUCCESS after a cancel still settles
   * it (LATE_SUCCESS, or DUPLICATE if the ticket was paid otherwise).
   */
  async cancel(actor: Actor, id: string, force: boolean): Promise<CancelResult> {
    const siteId = await this.site.getId();
    await locationFor(this.prisma, actor, siteId, 'BOOTH');
    const payment = UUID.test(id)
      ? await this.prisma.payment.findFirst({ where: { id, siteId, operatorId: actor.id, method: 'CARD' } })
      : null;
    if (!payment) throw new NotFoundException('Unknown payment');

    if (payment.status === 'SUCCESS' || payment.status === 'DUPLICATE') {
      throw new ConflictException('This payment succeeded; it cannot be cancelled.');
    }
    if (payment.status !== 'PENDING') {
      return { outcome: 'ALREADY_ENDED', forced: false, payment: await this.view(this.prisma, payment) };
    }

    const [age] = await this.prisma.$queryRaw<Array<{ allowed_at: Date; allowed: boolean }>>`
      SELECT created_at + make_interval(secs => ${CANCEL_AFTER_SECONDS}) AS allowed_at,
             now() >= created_at + make_interval(secs => ${CANCEL_AFTER_SECONDS}) AS allowed
        FROM payment WHERE id = ${payment.id}::uuid`;
    if (!age.allowed) {
      throw new ConflictException({
        statusCode: 409,
        message: `A card payment can be cancelled ${CANCEL_AFTER_SECONDS} seconds after it started.`,
        allowedAt: age.allowed_at,
      });
    }

    const answer = await this.gateway.verify(payment.reference);
    if (answer.kind === 'success' && answer.data) {
      const settled = await this.settlement.settleSuccess(payment.reference, answer.data, 'verify');
      const now = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (settled === 'amount-mismatch') {
        throw new ConflictException('Paystack reports a payment that does not match this ticket. Not cancelled; tell the administrator.');
      }
      return { outcome: 'ALREADY_PAID', forced: false, payment: await this.view(this.prisma, now) };
    }
    if (answer.kind === 'failed') {
      await this.settlement.markFailed(payment.reference, answer.data ?? {});
      const now = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return { outcome: now.status === 'FAILED' ? 'FAILED' : outcomeOf(now.status), forced: false, payment: await this.view(this.prisma, now) };
    }
    const forced = answer.kind === 'unknown';
    if (forced && !force) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message:
          'Paystack could not be reached, so it cannot be confirmed that the customer has not paid. ' +
          'Cancel anyway only if the customer did not pay by card.',
        outcome: 'unknown',
        canForce: true,
      });
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const ticket = await this.lockTicket(tx, payment.ticketId);
        const [{ status }] = await tx.$queryRaw<Array<{ status: Payment['status'] }>>`
          SELECT status::text AS status FROM payment WHERE id = ${payment.id}::uuid FOR UPDATE`;
        if (status !== 'PENDING') return { cancelled: false, status, ticketNumber: ticket.ticket_number };
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'ABANDONED' } });
        await this.audit.record({
          client: tx,
          actorId: actor.id,
          action: 'PAYMENT_CANCELLED',
          targetType: 'payment',
          targetId: payment.id,
          detail: { ticketNumber: ticket.ticket_number, forced },
        });
        return { cancelled: true, status: 'ABANDONED' as const, ticketNumber: ticket.ticket_number };
      },
      { timeout: 15_000 },
    );
    const now = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (!result.cancelled) {
      return { outcome: outcomeOf(result.status), forced: false, payment: await this.view(this.prisma, now) };
    }
    this.logger.log(
      `Payment ${payment.reference} for ticket ${result.ticketNumber} CANCELLED at the booth by ${actor.id}` +
        (forced ? ' (forced: Paystack could not be reached)' : ''),
    );
    return { outcome: 'CANCELLED', forced, payment: await this.view(this.prisma, now) };
  }

  // --------------------------------------------------------------- shared

  /** Exactly one of token or ticketId. Unknown or malformed: the same 404. */
  private async resolveTicket(siteId: string, input: BoothInput): Promise<string> {
    const byToken = input.token !== undefined;
    if (byToken === (input.ticketId !== undefined)) throw new BadRequestException('Give exactly one of token or ticketId');
    const miss = () => new NotFoundException('No ticket found');
    let rows: Array<{ id: string }>;
    if (byToken) {
      const token = input.token!.trim();
      if (!TOKEN_PATTERN.test(token)) throw miss();
      rows = await this.prisma.$queryRawUnsafe(
        `SELECT id::text AS id FROM ticket WHERE site_id = $1::uuid AND token = $2`,
        siteId,
        token,
      );
    } else {
      if (!UUID.test(input.ticketId!)) throw miss();
      rows = await this.prisma.$queryRawUnsafe(
        `SELECT id::text AS id FROM ticket WHERE site_id = $1::uuid AND id = $2::uuid`,
        siteId,
        input.ticketId,
      );
    }
    if (rows.length === 0) throw miss();
    return rows[0].id;
  }

  /** The ticket row, locked for this transaction, with expiry on the database clock. */
  private async lockTicket(tx: Prisma.TransactionClient, ticketId: string): Promise<LockedTicket> {
    const rows = await tx.$queryRawUnsafe<LockedTicket[]>(
      `SELECT payment_status::text AS payment_status, validation_status::text AS validation_status, fee_kobo,
              ticket_number, (now() >= valid_until) AS expired, now() AS db_now
         FROM ticket WHERE id = $1::uuid FOR UPDATE`,
      ticketId,
    );
    if (rows.length === 0) throw new NotFoundException('No ticket found');
    return rows[0];
  }

  /** A PENDING card payment for this ticket, seen under the ticket lock: 409. */
  private async refusePendingCardOf(tx: Prisma.TransactionClient, ticketId: string) {
    const pending = await tx.payment.findFirst({ where: { ticketId, status: 'PENDING' }, select: { id: true } });
    if (!pending) return;
    throw new ConflictException({
      statusCode: 409,
      message: 'A card payment for this ticket is in progress',
      pendingPaymentId: pending.id,
    });
  }

  /**
   * A PENDING card payment of this operator, or for this ticket, still
   * inside its window: 409 naming it. Past the window it is checked with
   * Paystack first and blocks only if Paystack still has it open.
   */
  private async refuseLivePending(siteId: string, of: { operatorId: string } | { ticketId: string }) {
    const pending = await this.prisma.payment.findFirst({ where: { siteId, status: 'PENDING', ...of } });
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
      message:
        'operatorId' in of
          ? 'A card payment is already in progress for you. Finish it or wait for it to be confirmed.'
          : 'A card payment for this ticket is in progress',
      pendingPaymentId: pending.id,
    });
  }

  /** The existing payment for this key, or null. 409 for a key that is not this request's. */
  private async replay(db: Db, siteId: string, idempotencyKey: string, request: { operatorId: string; subject: string }) {
    const existing = await db.payment.findUnique({ where: { idempotencyKey } });
    if (!existing) return null;
    const verdict =
      existing.siteId === siteId
        ? replayVerdict({ operatorId: existing.operatorId, subject: subjectOf(existing.ticketId, existing.method) }, request)
        : 'OTHER_OPERATOR';
    if (verdict === 'OTHER_OPERATOR') throw new ConflictException('This idempotency key has already been used.');
    if (verdict === 'DIFFERENT_REQUEST') {
      throw new ConflictException('This idempotency key was used for a different payment. Start a new attempt.');
    }
    return this.view(db, existing);
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

  /** The payment as the booth sees it, with the ticket summary (never the token). */
  async view(db: Db, payment: Payment): Promise<PaymentView> {
    const pending = payment.status === 'PENDING';
    return {
      id: payment.id,
      reference: payment.reference,
      method: payment.method,
      status: payment.status,
      amountKobo: payment.amountKobo,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      // The checkout only while there is something to pay on it.
      authorizationUrl: pending ? payment.authorizationUrl : null,
      accessCode: pending ? payment.accessCode : null,
      ticket: await loadSummary(db, payment.ticketId),
    };
  }
}

export interface PaymentView {
  id: string;
  reference: string;
  method: Payment['method'];
  status: Payment['status'];
  amountKobo: number;
  createdAt: Date;
  paidAt: Date | null;
  authorizationUrl: string | null;
  accessCode: string | null;
  ticket: TicketSummary;
}

/** The wait before a card payment may be cancelled (Sprint 4b review: 60 seconds). */
export const CANCEL_AFTER_SECONDS = 60;

export interface CancelResult {
  /** CANCELLED: now ABANDONED. ALREADY_PAID: Paystack had it paid (settled). ALREADY_ENDED: it had left PENDING. */
  outcome: 'CANCELLED' | 'ALREADY_PAID' | 'ALREADY_ENDED' | 'FAILED';
  /** True only when Paystack could not be reached and force was given. */
  forced: boolean;
  payment: PaymentView;
}

/** A payment found already out of PENDING under the lock. */
function outcomeOf(status: Payment['status']): CancelResult['outcome'] {
  if (status === 'SUCCESS' || status === 'DUPLICATE') return 'ALREADY_PAID';
  if (status === 'FAILED') return 'FAILED';
  return 'ALREADY_ENDED';
}

function subjectOf(ticketId: string, method: Method): string {
  return `${ticketId}:${method}`;
}

/** Refused at the booth, checked under the ticket lock on the database clock: 409, nothing written. */
function refuse(ticket: LockedTicket): void {
  if (ticket.validation_status === 'VALIDATED') throw new ConflictException('Ticket has already been used');
  if (ticket.payment_status === 'PAID') throw new ConflictException('Ticket is already paid');
  if (ticket.expired) throw new ConflictException('Ticket has expired');
}
