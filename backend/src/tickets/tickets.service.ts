import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.guard';
import { assertCategoryInUse } from '../config/category-in-use';
import { locationFor } from '../config/gate-in-service';
import { replayVerdict } from '../payments/idempotency';
import { TicketIssuer, isUniqueViolation } from './ticket-issuer';
import { loadSummaries, printView } from './ticket-view';

const RECENT_LIMIT = 50;
const LOOKUP_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 3 to 8 characters of the ticket-number alphabet, after the hyphen is dropped. */
const SUFFIX = /^[A-HJKMNP-Z2-9]{3,8}$/;

/** "Today" on the database clock: issued on the current Lagos day. */
const TODAY = 't.valid_until = lagos_day_end(now())';

/**
 * Entry (docs/01-flow.md, "Entry"; docs/api.md, "Entry"): create the ticket,
 * the operator's tickets of today, lookup by trailing characters, reprint.
 *
 * Every miss of a lookup is the same 404, and every miss of a reprint is the
 * same 404: a ticket number cannot be used to learn anything.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly audit: AuditService,
    private readonly issuer: TicketIssuer,
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

  /** Returns the print view and whether the ticket was newly created. */
  async create(actor: Actor, input: { categoryCode: string; idempotencyKey: string }, deviceRef: string) {
    const siteId = await this.site.getId();
    const gate = await locationFor(this.prisma, actor, siteId, 'ENTRY');
    const categoryCode = input.categoryCode.trim().toUpperCase();
    const request = { operatorId: actor.id, subject: categoryCode };

    const replay = await this.replay(siteId, input.idempotencyKey, request);
    if (replay) return { created: false, ticket: replay };

    const category = await this.prisma.vehicleCategory.findUnique({ where: { siteId_code: { siteId, code: categoryCode } } });
    assertCategoryInUse(categoryCode, category);

    let made: { id: string; ticketNumber: string };
    try {
      made = await this.issuer.issue(this.prisma, {
        siteId,
        idempotencyKey: input.idempotencyKey,
        operatorId: actor.id,
        gateId: gate.id,
        deviceRef,
        categoryId: category.id,
      });
    } catch (error) {
      // A tap with the same key got there first (it waited on the unique index).
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.replay(siteId, input.idempotencyKey, request);
      if (raced) return { created: false, ticket: raced };
      throw error;
    }
    this.logger.log(`ENTRY ticket ${made.ticketNumber} ${category.code} at ${gate.code} by ${actor.id}`);
    return { created: true, ticket: await this.print(siteId, made.id) };
  }

  /** The caller's own tickets issued today, newest first. Never the token. */
  async recent(actor: Actor) {
    const siteId = await this.site.getId();
    return loadSummaries(
      this.prisma,
      `t.site_id = $1::uuid AND t.operator_id = $2::uuid AND ${TODAY}`,
      [siteId, actor.id],
      `ORDER BY t.issued_at DESC, t.id LIMIT ${RECENT_LIMIT}`,
    );
  }

  /** Today's tickets whose number ends with the suffix. Every miss: the same 404. */
  async lookup(rawSuffix: unknown) {
    const miss = () => new NotFoundException('No ticket found');
    if (typeof rawSuffix !== 'string') throw miss();
    const suffix = rawSuffix.trim().toUpperCase().replace(/-/g, '');
    if (!SUFFIX.test(suffix)) throw miss();
    const siteId = await this.site.getId();
    // The suffix holds only alphabet characters (checked above): no LIKE wildcard can be in it.
    const found = await loadSummaries(
      this.prisma,
      `t.site_id = $1::uuid AND ${TODAY} AND replace(t.ticket_number, '-', '') LIKE '%' || $2`,
      [siteId, suffix],
      `ORDER BY t.issued_at DESC, t.id LIMIT ${LOOKUP_LIMIT}`,
    );
    if (found.length === 0) throw miss();
    return found;
  }

  /** The same QR for a ticket issued today and not validated. Audited. */
  async reprint(actor: Actor, ticketId: string) {
    const miss = () => new NotFoundException('No active ticket found');
    if (!UUID.test(ticketId)) throw miss();
    const siteId = await this.site.getId();
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT t.id::text AS id FROM ticket t
        WHERE t.id = $1::uuid AND t.site_id = $2::uuid AND t.validation_status = 'NOT_VALIDATED' AND ${TODAY}`,
      ticketId,
      siteId,
    );
    if (rows.length === 0) throw miss();

    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { operator: { select: { id: true, username: true } } },
    });
    // Never the token: the number and who issued it.
    await this.audit.record({
      actorId: actor.id,
      action: 'TICKET_REPRINTED',
      targetType: 'ticket',
      targetId: ticket.id,
      detail: { ticketNumber: ticket.ticketNumber, issuedBy: { id: ticket.operator.id, username: ticket.operator.username } },
    });
    return this.print(siteId, ticket.id);
  }

  /** The existing ticket for this key, as a print view, or null. 409 for a key that is not this request's. */
  private async replay(siteId: string, idempotencyKey: string, request: { operatorId: string; subject: string }) {
    const existing = await this.prisma.ticket.findUnique({
      where: { idempotencyKey },
      select: { id: true, siteId: true, operatorId: true, categoryCode: true },
    });
    if (!existing) return null;
    const verdict =
      existing.siteId === siteId
        ? replayVerdict({ operatorId: existing.operatorId, subject: existing.categoryCode }, request)
        : 'OTHER_OPERATOR';
    if (verdict === 'OTHER_OPERATOR') throw new ConflictException('This idempotency key has already been used.');
    if (verdict === 'DIFFERENT_REQUEST') {
      throw new ConflictException('This idempotency key was used for a different ticket. Start a new attempt.');
    }
    return this.print(siteId, existing.id);
  }

  private async print(siteId: string, ticketId: string) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { gate: { select: { code: true, name: true } }, operator: { select: { name: true } } },
    });
    const header = await this.prisma.siteSetting.findUniqueOrThrow({
      where: { siteId },
      select: { displayName: true, receiptOrgName: true, receiptContactLine: true },
    });
    return printView(ticket, header);
  }
}
