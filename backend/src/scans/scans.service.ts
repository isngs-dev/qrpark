import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import type { Actor } from '../auth/auth.guard';
import { directionFor } from '../users/user-rules';
import { locationFor } from '../config/gate-in-service';
import { TOKEN_PATTERN } from '../tickets/ticket-codes';
import { ScanStore, type Inspected, type ScanRecord } from './scan-store';

/**
 * Validate (exit) and check (read) a scanned ticket. docs/api.md, "Scans".
 *
 * Order, for both:
 *   1. The operator's location (in service, of the job's kind). Refused:
 *      400, nothing written. Not a scan.
 *   2. The token's SHAPE, before any database lookup. Wrong shape:
 *      INVALID_QR, recorded with no ticket.
 *   3. Validate: ScanStore.consume, the one conditional UPDATE (PAID, not
 *      validated, not expired). If it changed nothing, ScanStore.inspect (a
 *      read) says why. Check: ScanStore.inspect only; never consume.
 *   4. The scan record, in the SAME transaction as the consume, so a
 *      validated ticket always has its record and a failed record leaves it
 *      NOT_VALIDATED.
 *
 * Why, in this order: VALIDATED -> ALREADY_USED; expired -> EXPIRED;
 * UNPAID -> PAYMENT_REQUIRED; no ticket -> NOT_FOUND. A ticket that reads
 * PAID, not validated and not expired after consume changed nothing is 503
 * "cannot verify" at exit, never VALID.
 *
 * The scanned token is never logged, never echoed and never in an error.
 */

type Result = ScanRecord['result'];
type Base = Omit<ScanRecord, 'ticketId' | 'result'>;

@Injectable()
export class ScansService {
  private readonly logger = new Logger(ScansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly store: ScanStore,
  ) {}

  async validate(actor: Actor, scanned: string, deviceRef: string) {
    const siteId = await this.site.getId();
    const gate = await locationFor(this.prisma, actor, siteId, 'EXIT');
    const token = scanned.trim();
    const base: Base = { siteId, kind: 'EXIT', gateId: gate.id, operatorId: actor.id, deviceRef };

    if (!TOKEN_PATTERN.test(token)) return this.recordOnly(base, 'INVALID_QR', gate.code);

    const answer = await this.prisma.$transaction(
      async (tx) => {
        const closed = await this.store.consume(tx, { siteId, token, gateId: gate.id, operatorId: actor.id });
        if (closed) {
          const { occurredAt } = await this.store.record(tx, { ...base, ticketId: closed.ticketId, result: 'VALID' });
          const { ticketId: _id, usedAt: _at, ...ticket } = closed;
          return { result: 'VALID' as const, scannedAt: occurredAt, ticket, ticketNumber: closed.ticketNumber };
        }
        const found = await this.store.inspect(tx, { siteId, token });
        if (found && reason(found) === null) {
          // consume should have validated it. Do not guess; never approve.
          throw new ServiceUnavailableException('Cannot verify this ticket. Try again; do not let the vehicle out.');
        }
        return this.refusal(tx, base, found, actor.id);
      },
      { timeout: 15_000 },
    );

    this.logger.log(`EXIT ${answer.result} ticket ${answer.ticketNumber ?? '-'} at ${gate.code} by ${actor.id}`);
    const { ticketNumber: _n, ...response } = answer;
    return response;
  }

  async check(actor: Actor, scanned: string, deviceRef: string) {
    const siteId = await this.site.getId();
    const kind = directionFor(actor.role);
    if (!kind) throw new BadRequestException('This account has no operator job');
    const gate = await locationFor(this.prisma, actor, siteId, kind);
    const token = scanned.trim();
    const base: Base = { siteId, kind: 'CHECK', gateId: gate.id, operatorId: actor.id, deviceRef };

    if (!TOKEN_PATTERN.test(token)) return this.recordOnly(base, 'INVALID_QR', gate.code);

    const answer = await this.prisma.$transaction(async (tx) => {
      const found = await this.store.inspect(tx, { siteId, token });
      if (found && reason(found) === null) {
        const { occurredAt } = await this.store.record(tx, { ...base, ticketId: found.ticketId, result: 'ACTIVE' });
        return { result: 'ACTIVE' as const, scannedAt: occurredAt, ticket: found.summary, ticketNumber: found.summary.ticketNumber };
      }
      return this.refusal(tx, base, found, actor.id);
    });

    this.logger.log(`CHECK ${answer.result} ticket ${answer.ticketNumber ?? '-'} at ${gate.code} by ${actor.id}`);
    const { ticketNumber: _n, ...response } = answer;
    return response;
  }

  /** NOT_FOUND, ALREADY_USED, EXPIRED or PAYMENT_REQUIRED, recorded. */
  private async refusal(tx: Parameters<ScanStore['record']>[0], base: Base, found: Inspected | null, actorId: string) {
    if (!found) {
      const { occurredAt } = await this.store.record(tx, { ...base, ticketId: null, result: 'NOT_FOUND' });
      return { result: 'NOT_FOUND' as const, scannedAt: occurredAt, ticketNumber: null };
    }
    const result = reason(found)!;
    const { occurredAt } = await this.store.record(tx, { ...base, ticketId: found.ticketId, result });
    const common = { scannedAt: occurredAt, ticket: found.summary, ticketNumber: found.summary.ticketNumber };
    if (result === 'ALREADY_USED') {
      return {
        result,
        ...common,
        usedAt: found.usedAt,
        usedGate: found.usedGate,
        usedBy: found.usedBy ? { name: found.usedBy.name, username: found.usedBy.username } : null,
        usedByYou: found.usedBy?.id === actorId,
      };
    }
    if (result === 'EXPIRED') return { result, ...common, validUntil: found.summary.validUntil };
    return { result, ...common };
  }

  private async recordOnly(base: Base, result: Result, gateCode: string) {
    const { occurredAt } = await this.store.record(this.prisma, { ...base, ticketId: null, result });
    this.logger.log(`${base.kind} ${result} at ${gateCode} by ${base.operatorId}`);
    return { result, scannedAt: occurredAt };
  }
}

/** Why a found ticket cannot leave, in precedence order; null when it is paid, unused and valid today. */
function reason(found: Inspected): 'ALREADY_USED' | 'EXPIRED' | 'PAYMENT_REQUIRED' | null {
  const t = found.summary;
  if (t.validationStatus === 'VALIDATED') return 'ALREADY_USED';
  if (t.state === 'EXPIRED') return 'EXPIRED';
  if (t.paymentStatus !== 'PAID') return 'PAYMENT_REQUIRED';
  return null;
}
