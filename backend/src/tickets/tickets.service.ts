import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.guard';
import { normaliseTicketNumber } from './ticket-codes';
import { ticketState, ticketView } from './ticket-view';

const RECENT_HOURS = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The operator's recent tickets, and reprints (docs/01-flow.md, "Reprint").
 *
 * A reprint is the SAME QR. Any entry operator of the site may reprint, from
 * the recent list or by ticket number; only an ACTIVE ticket (not used, not
 * expired); every reprint audited with who reprinted and who issued it.
 *
 * Every miss gets the same 404: an unknown id or number, a malformed one, a
 * used or an expired ticket. A ticket number cannot be used to learn anything.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly audit: AuditService,
  ) {}

  /** Own tickets of the last 24 hours, newest first. WITHOUT the token. */
  async recent(actor: Actor) {
    const siteId = await this.site.getId();
    const rows = await this.prisma.ticket.findMany({
      where: { siteId, operatorId: actor.id, issuedAt: { gte: new Date(Date.now() - RECENT_HOURS * 3600_000) } },
      orderBy: { issuedAt: 'desc' },
      take: 50,
    });
    const now = new Date();
    return rows.map((t) => ({
      id: t.id,
      paymentId: t.paymentId,
      ticketNumber: t.ticketNumber,
      state: ticketState(t, now),
      categoryName: t.categoryName,
      amountKobo: t.amountKobo,
      customerName: t.customerName,
      paidAt: t.paidAt,
      validUntil: t.validUntil,
      issuedAt: t.issuedAt,
    }));
  }

  async reprint(actor: Actor, input: { ticketId?: string; ticketNumber?: string }) {
    const byId = input.ticketId !== undefined;
    const byNumber = input.ticketNumber !== undefined;
    if (byId === byNumber) throw new BadRequestException('Give exactly one of ticketId or ticketNumber');

    const miss = () => new NotFoundException('No active ticket found');
    const siteId = await this.site.getId();
    const now = new Date();

    let where: { id: string } | { siteId_ticketNumber: { siteId: string; ticketNumber: string } };
    if (byId) {
      if (!UUID.test(input.ticketId!)) throw miss();
      where = { id: input.ticketId! };
    } else {
      const ticketNumber = normaliseTicketNumber(input.ticketNumber!);
      if (!ticketNumber) throw miss();
      where = { siteId_ticketNumber: { siteId, ticketNumber } };
    }

    const ticket = await this.prisma.ticket.findUnique({
      where,
      include: {
        gate: { select: { code: true, name: true } },
        operator: { select: { id: true, name: true, username: true } },
      },
    });
    if (!ticket || ticket.siteId !== siteId || ticketState(ticket, now) !== 'ACTIVE') throw miss();

    // Never the token: the number, the route and who issued it.
    await this.audit.record({
      actorId: actor.id,
      action: 'TICKET_REPRINTED',
      targetType: 'ticket',
      targetId: ticket.id,
      detail: {
        ticketNumber: ticket.ticketNumber,
        via: byId ? 'id' : 'number',
        issuedBy: { id: ticket.operator.id, username: ticket.operator.username },
      },
    });

    const header = await this.prisma.siteSetting.findUniqueOrThrow({
      where: { siteId },
      select: { displayName: true, receiptOrgName: true, receiptContactLine: true },
    });
    return ticketView(ticket, header, now);
  }
}
