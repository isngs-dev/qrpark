import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Every database statement a scan makes, and nothing else. Three methods:
 *
 *   consume   THE single conditional UPDATE that closes a ticket (validate only)
 *   inspect   a read that decides why consume changed nothing, or answers a
 *             check. Never writes.
 *   record    the scan_event row
 *
 * Every time is the DATABASE clock (now()), never Node's: the expiry test,
 * used_at and occurred_at. Inside one transaction now() is one instant, so a
 * VALID scan's used_at and occurred_at are equal.
 *
 * Kept this small on purpose: the tests wrap these three methods to prove a
 * malformed token never reaches consume or inspect, and that check never
 * calls consume.
 *
 * The token is a bound parameter ($1), never part of the SQL text, so a
 * database error cannot carry it.
 */

export type Db = PrismaClient | Prisma.TransactionClient;

export interface Consumed {
  ticketId: string;
  ticketNumber: string;
  categoryName: string;
  customerName: string | null;
  paidAt: Date;
  validUntil: Date;
  usedAt: Date;
}

export interface Inspected {
  ticketId: string;
  ticketNumber: string;
  categoryName: string;
  customerName: string | null;
  paidAt: Date;
  validUntil: Date;
  status: 'ACTIVE' | 'USED';
  /** ACTIVE and past valid_until, by the database clock. */
  expired: boolean;
  usedAt: Date | null;
  usedGate: { code: string; name: string } | null;
  usedBy: { id: string; name: string; username: string } | null;
}

export interface ScanRecord {
  siteId: string;
  ticketId: string | null;
  kind: 'CHECK' | 'EXIT';
  result: 'VALID' | 'ACTIVE' | 'ALREADY_USED' | 'EXPIRED' | 'NOT_FOUND' | 'INVALID_QR';
  gateId: string;
  operatorId: string;
  deviceRef: string;
}

@Injectable()
export class ScanStore {
  /**
   * Close the ticket if, and only if, it is ACTIVE and not expired, in ONE
   * statement. Postgres row-locks the ticket for the UPDATE: of any number of
   * simultaneous calls, the first changes it and every other one re-checks
   * the WHERE against the committed row, finds it USED, and changes nothing.
   * Null when nothing was changed.
   */
  async consume(
    db: Db,
    input: { siteId: string; token: string; gateId: string; operatorId: string },
  ): Promise<Consumed | null> {
    const rows = await db.$queryRawUnsafe<
      Array<{
        ticket_id: string;
        ticket_number: string;
        category_name: string;
        customer_name: string | null;
        paid_at: Date;
        valid_until: Date;
        used_at: Date;
      }>
    >(
      `UPDATE ticket
          SET status = 'USED', used_at = now(), used_gate_id = $3::uuid, used_by_id = $4::uuid, updated_at = now()
        WHERE site_id = $2::uuid AND token = $1 AND status = 'ACTIVE' AND valid_until >= now()
        RETURNING id::text AS ticket_id, ticket_number, category_name, customer_name, paid_at, valid_until, used_at`,
      input.token,
      input.siteId,
      input.gateId,
      input.operatorId,
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ticketId: r.ticket_id,
      ticketNumber: r.ticket_number,
      categoryName: r.category_name,
      customerName: r.customer_name,
      paidAt: r.paid_at,
      validUntil: r.valid_until,
      usedAt: r.used_at,
    };
  }

  /** Read the ticket for this token at this site. Never writes. Null when there is none. */
  async inspect(db: Db, input: { siteId: string; token: string }): Promise<Inspected | null> {
    const rows = await db.$queryRawUnsafe<
      Array<{
        ticket_id: string;
        ticket_number: string;
        category_name: string;
        customer_name: string | null;
        paid_at: Date;
        valid_until: Date;
        status: 'ACTIVE' | 'USED';
        expired: boolean;
        used_at: Date | null;
        gate_code: string | null;
        gate_name: string | null;
        user_id: string | null;
        user_name: string | null;
        user_username: string | null;
      }>
    >(
      `SELECT t.id::text AS ticket_id, t.ticket_number, t.category_name, t.customer_name, t.paid_at,
              t.valid_until, t.status::text AS status,
              (t.status = 'ACTIVE' AND t.valid_until < now()) AS expired,
              t.used_at, g.code AS gate_code, g.name AS gate_name,
              u.id::text AS user_id, u.name AS user_name, u.username AS user_username
         FROM ticket t
         LEFT JOIN gate g ON g.id = t.used_gate_id
         LEFT JOIN app_user u ON u.id = t.used_by_id
        WHERE t.site_id = $2::uuid AND t.token = $1`,
      input.token,
      input.siteId,
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ticketId: r.ticket_id,
      ticketNumber: r.ticket_number,
      categoryName: r.category_name,
      customerName: r.customer_name,
      paidAt: r.paid_at,
      validUntil: r.valid_until,
      status: r.status,
      expired: r.expired,
      usedAt: r.used_at,
      usedGate: r.gate_code !== null ? { code: r.gate_code, name: r.gate_name! } : null,
      usedBy: r.user_id !== null ? { id: r.user_id, name: r.user_name!, username: r.user_username! } : null,
    };
  }

  /** The scan_event row, at the database's now(). Never the scanned text. */
  async record(db: Db, input: ScanRecord): Promise<{ occurredAt: Date }> {
    const rows = await db.$queryRawUnsafe<Array<{ occurred_at: Date }>>(
      `INSERT INTO scan_event (id, site_id, ticket_id, kind, result, gate_id, operator_id, device_ref, occurred_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::scan_kind, $4::scan_result, $5::uuid, $6::uuid, $7, now())
       RETURNING occurred_at`,
      input.siteId,
      input.ticketId,
      input.kind,
      input.result,
      input.gateId,
      input.operatorId,
      input.deviceRef,
    );
    return { occurredAt: rows[0].occurred_at };
  }
}
