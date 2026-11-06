import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { call, type TestApp, type TestUser } from './app';

/** Helpers shared by the payment, webhook, job and ticket tests. */

export async function addCategory(t: TestApp, code: string, priceKobo: number, isActive = true) {
  return t.prisma.vehicleCategory.create({
    data: { siteId: t.siteId, code, name: code.charAt(0) + code.slice(1).toLowerCase(), priceKobo, isActive },
  });
}

/** Another entry operator at the same entry gate. */
export async function addEntryOperator(t: TestApp, username: string): Promise<TestUser> {
  const password = randomBytes(18).toString('base64url');
  const row = await t.prisma.appUser.create({
    data: {
      siteId: t.siteId,
      username,
      name: username,
      role: 'ENTRY_OPERATOR',
      gateId: t.entryGateId,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  return { id: row.id, username, password, role: 'ENTRY_OPERATOR' };
}

export function newKey(): string {
  return randomUUID();
}

export async function startPayment(
  t: TestApp,
  userId: string,
  body: { categoryCode: string; customerName?: string | null; idempotencyKey?: string },
) {
  const token = await t.accessToken(userId);
  return call(t, 'POST', '/payments', { token, body: { idempotencyKey: newKey(), ...body } });
}

export async function getPayment(t: TestApp, userId: string, paymentId: string) {
  return call(t, 'GET', `/payments/${paymentId}`, { token: await t.accessToken(userId) });
}

/** Moves a payment's start back in time, as if it had been waiting that long. */
export async function agePayment(t: TestApp, paymentId: string, minutes: number) {
  await t.prisma.$executeRawUnsafe(
    `UPDATE payment SET created_at = created_at - ($1 || ' minutes')::interval WHERE id = $2::uuid`,
    String(minutes),
    paymentId,
  );
}

/** Ends every PENDING payment of an operator so the next test starts clean. */
export async function clearPending(t: TestApp, operatorId: string) {
  await t.prisma.payment.updateMany({ where: { operatorId, status: 'PENDING' }, data: { status: 'ABANDONED' } });
}
