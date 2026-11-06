import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import type { Actor } from '../auth/auth.guard';
import { directionFor } from '../users/user-rules';
import { assertGateAcceptsExit, assertGateInService } from '../config/gate-in-service';
import { TOKEN_PATTERN } from '../tickets/ticket-codes';
import { ScanStore, type Inspected, type ScanRecord } from './scan-store';

/**
 * Validate (close) and check (read) a scanned ticket. docs/api.md, "Scans".
 *
 * Order, for both:
 *   1. The operator's gate (in service, facing the right way). Refused: 400,
 *      nothing written. Not a scan.
 *   2. The token's SHAPE, before any database lookup. Wrong shape:
 *      INVALID_QR, recorded with no ticket.
 *   3. Validate: ScanStore.consume, the one conditional UPDATE. If it changed
 *      nothing, ScanStore.inspect (a read) says why.
 *      Check: ScanStore.inspect only. Check never calls consume.
 *   4. The scan record, in the SAME transaction as the consume, so a closed
 *      ticket always has its record and a failed record leaves it ACTIVE.
 *
 * Never VALID unless consume returned the ticket. If inspect then reads the
 * ticket as ACTIVE and still valid (which consume makes impossible), the
 * answer is 503 "cannot verify", not VALID.
 *
 * The scanned token is never logged, never echoed and never in an error.
 */

type Result = ScanRecord['result'];

const TICKET = (t: { ticketNumber: string; categoryName: string; customerName: string | null; paidAt: Date; validUntil: Date }) => ({
  ticketNumber: t.ticketNumber,
  categoryName: t.categoryName,
  customerName: t.customerName,
  paidAt: t.paidAt,
  validUntil: t.validUntil,
});

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
    const gate = await this.gateFor(actor, siteId, 'EXIT');
    const token = scanned.trim();
    const base = { siteId, kind: 'EXIT' as const, gateId: gate.id, operatorId: actor.id, deviceRef };

    if (!TOKEN_PATTERN.test(token)) return this.recordOnly(base, 'INVALID_QR', gate.code);

    const answer = await this.prisma.$transaction(
      async (tx) => {
        const closed = await this.store.consume(tx, { siteId, token, gateId: gate.id, operatorId: actor.id });
        if (closed) {
          const { occurredAt } = await this.store.record(tx, { ...base, ticketId: closed.ticketId, result: 'VALID' });
          return { result: 'VALID' as const, scannedAt: occurredAt, ticket: TICKET(closed), ticketNumber: closed.ticketNumber };
        }

        const found = await this.store.inspect(tx, { siteId, token });
        if (found && found.status === 'ACTIVE' && !found.expired) {
          // consume should have closed it. Do not guess; never approve.
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
    const gate = await this.gateFor(actor, siteId, directionFor(actor.role));
    const token = scanned.trim();
    const base = { siteId, kind: 'CHECK' as const, gateId: gate.id, operatorId: actor.id, deviceRef };

    if (!TOKEN_PATTERN.test(token)) return this.recordOnly(base, 'INVALID_QR', gate.code);

    const answer = await this.prisma.$transaction(async (tx) => {
      const found = await this.store.inspect(tx, { siteId, token });
      if (found && found.status === 'ACTIVE' && !found.expired) {
        const { occurredAt } = await this.store.record(tx, { ...base, ticketId: found.ticketId, result: 'ACTIVE' });
        return { result: 'ACTIVE' as const, scannedAt: occurredAt, ticket: TICKET(found), ticketNumber: found.ticketNumber };
      }
      return this.refusal(tx, base, found, actor.id);
    });

    this.logger.log(`CHECK ${answer.result} ticket ${answer.ticketNumber ?? '-'} at ${gate.code} by ${actor.id}`);
    const { ticketNumber: _n, ...response } = answer;
    return response;
  }

  /** ALREADY_USED, EXPIRED or NOT_FOUND, recorded. */
  private async refusal(
    tx: Parameters<ScanStore['record']>[0],
    base: Omit<ScanRecord, 'ticketId' | 'result'>,
    found: Inspected | null,
    actorId: string,
  ) {
    if (!found) {
      const { occurredAt } = await this.store.record(tx, { ...base, ticketId: null, result: 'NOT_FOUND' });
      return { result: 'NOT_FOUND' as const, scannedAt: occurredAt, ticketNumber: null };
    }
    if (found.status === 'USED') {
      const { occurredAt } = await this.store.record(tx, { ...base, ticketId: found.ticketId, result: 'ALREADY_USED' });
      return {
        result: 'ALREADY_USED' as const,
        scannedAt: occurredAt,
        usedAt: found.usedAt,
        usedGate: found.usedGate,
        usedBy: found.usedBy ? { name: found.usedBy.name, username: found.usedBy.username } : null,
        usedByYou: found.usedBy?.id === actorId,
        ticket: TICKET(found),
        ticketNumber: found.ticketNumber,
      };
    }
    const { occurredAt } = await this.store.record(tx, { ...base, ticketId: found.ticketId, result: 'EXPIRED' });
    return {
      result: 'EXPIRED' as const,
      scannedAt: occurredAt,
      validUntil: found.validUntil,
      ticket: TICKET(found),
      ticketNumber: found.ticketNumber,
    };
  }

  private async recordOnly(base: Omit<ScanRecord, 'ticketId' | 'result'>, result: Result, gateCode: string) {
    const { occurredAt } = await this.store.record(this.prisma, { ...base, ticketId: null, result });
    this.logger.log(`${base.kind} ${result} at ${gateCode} by ${base.operatorId}`);
    return { result, scannedAt: occurredAt };
  }

  /** The operator's gate: in service, and facing `direction`. Refused: 400, nothing written. */
  private async gateFor(actor: Actor, siteId: string, direction: 'ENTRY' | 'EXIT' | null) {
    const gate = actor.gateId ? await this.prisma.gate.findFirst({ where: { id: actor.gateId, siteId } }) : null;
    assertGateInService(gate);
    if (direction === 'EXIT') assertGateAcceptsExit(gate!);
    else if (gate!.direction !== 'ENTRY') {
      throw new BadRequestException(`Gate "${gate!.code}" is an exit gate; an entry operator checks at an entry gate.`);
    }
    return gate!;
  }
}
