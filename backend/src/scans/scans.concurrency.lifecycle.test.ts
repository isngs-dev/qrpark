import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp, type TestUser } from '../test-support/app';
import { addOperator, issueTicket, scan } from '../test-support/scans';

/**
 * Single-use exit under real concurrency, over HTTP: N requests for ONE
 * ticket sent at once, from N different exit operators, 30 rounds each.
 * Exactly one VALID per round; every other answer ALREADY_USED; one scan
 * record per request.
 *
 * The pool must allow the requests to reach Postgres together:
 * PrismaService sets connection_limit to at least 10 (prisma-pool.test.ts).
 */

const ROUNDS = 30;
let t: TestApp;
const operators: TestUser[] = [];

before(async () => {
  t = await bootTestApp();
  for (let i = 0; i < 10; i++) operators.push(await addOperator(t, `exit.race${i}`, 'EXIT_OPERATOR', t.exitGateId));
});
after(() => t?.close());

async function race(n: number) {
  const tokens = await Promise.all(operators.slice(0, n).map((o) => t.accessToken(o.id)));
  for (let round = 1; round <= ROUNDS; round++) {
    const tk = await issueTicket(t);
    const scansBefore = await t.prisma.scanEvent.count({ where: { ticketId: tk.id } });

    const results = await Promise.all(
      operators.slice(0, n).map((o, i) =>
        fetch(`${t.url}/tickets/validate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[i]}`, 'x-device-id': `race-${i}` },
          body: JSON.stringify({ token: tk.token }),
        }).then(async (r) => ({ status: r.status, body: (await r.json()) as { result: string; usedByYou?: boolean } })),
      ),
    );

    const outcomes = results.map((r) => `${r.status}:${r.body.result}`).sort();
    const expected = [...Array(n - 1).fill('200:ALREADY_USED'), '200:VALID'].sort();
    assert.deepEqual(outcomes, expected, `round ${round} with ${n}: ${outcomes.join(', ')}`);

    const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
    assert.equal(row.status, 'USED');
    const winner = results.findIndex((r) => r.body.result === 'VALID');
    assert.equal(row.usedById, operators[winner].id, `round ${round}: the ticket names someone other than the VALID caller`);
    for (const [i, r] of results.entries()) {
      if (i !== winner) assert.equal(r.body.usedByYou, false, `round ${round}: a loser was told it closed the ticket`);
    }
    assert.equal(await t.prisma.scanEvent.count({ where: { ticketId: tk.id } }) - scansBefore, n, `round ${round}: scan records`);
  }
}

test(`two exit operators validate one ticket at the same moment: exactly one VALID, ${ROUNDS} rounds`, async () => {
  await race(2);
});

test(`ten exit operators validate one ticket at the same moment: exactly one VALID, ${ROUNDS} rounds`, async () => {
  await race(10);
});
