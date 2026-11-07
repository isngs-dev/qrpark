import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { newTicketNumber, newToken } from './ticket-codes';

/** How many fresh ticket numbers are tried before giving up (one in 852 billion odds each). */
const NUMBER_ATTEMPTS = 5;

/**
 * Creates a ticket at ENTRY (Sprint R): UNPAID, NOT_VALIDATED, the fee
 * snapshot copied from the category in the SAME statement (so the price is
 * the one at this moment), issued_at and valid_until set by the database
 * (ticket_insert_guard: valid_until = lagos_day_end(issued_at)).
 *
 * A ticket-number clash inserts nothing and raises nothing
 * (ON CONFLICT (site_id, ticket_number) DO NOTHING); the next number is
 * tried. A second insert with the same idempotency key is NOT absorbed: it
 * raises the unique violation, which the caller turns into a replay.
 */
@Injectable()
export class TicketIssuer {
  /** Replaceable in tests, to force a collision. */
  nextNumber: () => string = () => newTicketNumber();

  async issue(
    db: PrismaClient | Prisma.TransactionClient,
    input: { siteId: string; idempotencyKey: string; operatorId: string; gateId: string; deviceRef: string; categoryId: string },
  ): Promise<{ id: string; ticketNumber: string }> {
    for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
      const ticketNumber = this.nextNumber();
      const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO ticket (id, site_id, idempotency_key, token, ticket_number, operator_id, gate_id, device_ref,
           category_id, category_code, category_name, fee_kobo, updated_at)
         SELECT gen_random_uuid(), $1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7,
           c.id, c.code, c.name, c.price_kobo, now()
           FROM vehicle_category c
          WHERE c.id = $8::uuid AND c.site_id = $1::uuid
         ON CONFLICT (site_id, ticket_number) DO NOTHING
         RETURNING id::text`,
        input.siteId,
        input.idempotencyKey,
        newToken(),
        ticketNumber,
        input.operatorId,
        input.gateId,
        input.deviceRef,
        input.categoryId,
      );
      if (rows.length === 1) return { id: rows[0].id, ticketNumber };
    }
    throw new InternalServerErrorException('Could not allocate a ticket number');
  }
}

/** A unique violation, from a Prisma call (P2002) or a raw statement (P2010 / 23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002') return true;
  return error.code === 'P2010' && (error.meta as { code?: string } | undefined)?.code === '23505';
}
