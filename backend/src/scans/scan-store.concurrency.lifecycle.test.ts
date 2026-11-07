import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { bootTestApp, type TestApp } from '../test-support/app';
import { issueTicket } from '../test-support/scans';
import { ScanStore } from './scan-store';

/**
 * The closing statement itself under contention, with no HTTP and no shared
 * pool in between: TEN separate PrismaClient instances (ten separate
 * connections to Postgres), all connected first, call ScanStore.consume for
 * the same ticket at the same moment. 30 rounds. Exactly one gets the ticket
 * row back each round.
 */

const ROUNDS = 30;
const CLIENTS = 10;
let t: TestApp;
const clients: PrismaClient[] = [];
const store = new ScanStore();

before(async () => {
  t = await bootTestApp();
  for (let i = 0; i < CLIENTS; i++) {
    const client = new PrismaClient();
    await client.$connect();
    // Warm each connection, so all ten are open before the race starts.
    await client.$queryRaw`SELECT 1`;
    clients.push(client);
  }
});
after(async () => {
  await Promise.all(clients.map((c) => c.$disconnect()));
  await t?.close();
});

test(`${CLIENTS} separate connections call consume() for one ticket at once: exactly one row back, ${ROUNDS} rounds`, async () => {
  const backends = await Promise.all(
    clients.map((c) => c.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`),
  );
  assert.equal(new Set(backends.map((b) => b[0].pid)).size, CLIENTS, 'the clients do not hold separate connections');

  for (let round = 1; round <= ROUNDS; round++) {
    const tk = await issueTicket(t);
    const results = await Promise.all(
      clients.map((client) =>
        store.consume(client, { siteId: t.siteId, token: tk.token, gateId: t.exitGateId, operatorId: t.users.exit.id }),
      ),
    );
    const winners = results.filter((r) => r !== null);
    assert.equal(winners.length, 1, `round ${round}: ${winners.length} connections closed the same ticket`);
    assert.equal(winners[0]!.ticketId, tk.id);
    const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
    assert.equal(row.validationStatus, 'VALIDATED');
    assert.equal(row.validatedAt!.getTime(), winners[0]!.usedAt.getTime());
  }
});
