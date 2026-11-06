import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { newTicketNumber, newToken } from './ticket-codes';

/** How many fresh ticket numbers are tried before giving up (one in 852 billion odds each). */
const NUMBER_ATTEMPTS = 5;

/**
 * Creates THE ticket for a payment, inside the transaction that marks the
 * payment SUCCESS. Called from nowhere else.
 *
 * The database backs it twice: ticket_requires_success_payment refuses a
 * ticket for any payment not SUCCESS, and ticket_payment_id_key refuses a
 * second ticket for one payment.
 *
 * A ticket-number collision must not abort the transaction (a failed INSERT
 * would). So the insert is ON CONFLICT (site_id, ticket_number) DO NOTHING:
 * a clash inserts no row and raises nothing, and the next number is tried.
 */
@Injectable()
export class TicketIssuer {
  /** Replaceable in tests, to force a collision. */
  nextNumber: () => string = () => newTicketNumber();

  async issue(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      siteId: string;
      operatorId: string;
      gateId: string;
      categoryName: string;
      amountKobo: number;
      customerName: string | null;
      reference: string;
    },
    paidAt: Date,
  ): Promise<{ id: string; ticketNumber: string }> {
    // Read now, at issue time: the value is stored on the ticket, and a later
    // change to the setting never reaches it.
    const setting = await tx.siteSetting.findUniqueOrThrow({
      where: { siteId: payment.siteId },
      select: { validityHours: true },
    });

    for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
      const ticketNumber = this.nextNumber();
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO ticket (id, site_id, payment_id, token, ticket_number, operator_id, gate_id,
           category_name, amount_kobo, customer_name, payment_reference,
           paid_at, validity_hours, valid_until, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid,
           $7, $8::int, $9, $10,
           $11::timestamptz, $12::int, $11::timestamptz + make_interval(hours => $12::int), now())
         ON CONFLICT (site_id, ticket_number) DO NOTHING
         RETURNING id::text`,
        payment.siteId,
        payment.id,
        newToken(),
        ticketNumber,
        payment.operatorId,
        payment.gateId,
        payment.categoryName,
        payment.amountKobo,
        payment.customerName,
        payment.reference,
        paidAt.toISOString(),
        setting.validityHours,
      );
      if (rows.length === 1) return { id: rows[0].id, ticketNumber };
    }
    throw new InternalServerErrorException('Could not allocate a ticket number');
  }
}
