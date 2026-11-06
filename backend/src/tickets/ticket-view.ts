import type { Ticket } from '@prisma/client';

/**
 * What the app prints and shows. INCLUDES THE TOKEN: only ever returned to
 * the operator who took the payment (GET /payments/:id) or to an entry
 * operator reprinting it (POST /tickets/reprint). Never logged, never in
 * audit detail.
 *
 * `state` derives EXPIRED: an ACTIVE ticket past valid_until.
 */
export function ticketView(
  ticket: Ticket & { gate: { code: string; name: string }; operator: { name: string } },
  header: { displayName: string; receiptOrgName: string | null; receiptContactLine: string | null },
  now: Date = new Date(),
) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    token: ticket.token,
    state: ticketState(ticket, now),
    categoryName: ticket.categoryName,
    amountKobo: ticket.amountKobo,
    customerName: ticket.customerName,
    paymentReference: ticket.paymentReference,
    paidAt: ticket.paidAt,
    validUntil: ticket.validUntil,
    issuedAt: ticket.issuedAt,
    gate: { code: ticket.gate.code, name: ticket.gate.name },
    operator: { name: ticket.operator.name },
    header,
  };
}

export function ticketState(ticket: { status: string; validUntil: Date }, now: Date = new Date()) {
  if (ticket.status === 'USED') return 'USED' as const;
  return ticket.validUntil.getTime() < now.getTime() ? ('EXPIRED' as const) : ('ACTIVE' as const);
}
