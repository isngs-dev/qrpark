import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, type TestApp } from '../test-support/app';
import { postWebhook, successData } from '../test-support/paystack';
import { addBoothOperator, newKey } from '../test-support/payments';
import { as, makeTicket } from '../test-support/tickets';

/**
 * Cash confirm and Paystack's SUCCESS webhook for the SAME ticket at the same
 * moment, 30 rounds each. Whatever the order: exactly one SUCCESS payment, the
 * ticket PAID once through it, the loser 409 (cash) or DUPLICATE (card), and
 * no deadlock or 5xx. Both paths lock the ticket row first.
 *
 *  - Card ABANDONED (the customer finished a checkout that had timed out):
 *    either cash wins and the card becomes DUPLICATE, or the card wins and
 *    cash is refused as already paid.
 *  - Card PENDING: cash is refused (a card payment is in progress) or, if the
 *    card settles first, refused as already paid.
 */

const ROUNDS = 30;
let t: TestApp;
let carder: string;

before(async () => {
  t = await bootTestApp();
  // The card payments belong to a second booth operator, so the cash
  // operator's own PENDING rule never decides the race.
  carder = (await addBoothOperator(t, 'booth.carder')).id;
});
after(() => t?.close());

async function cardPayment(ticketId: string, status: 'PENDING' | 'ABANDONED') {
  const res = await as(t, carder, 'POST', '/payments/card', { ticketId, idempotencyKey: newKey() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  if (status === 'ABANDONED') await t.prisma.payment.update({ where: { id: res.body.id }, data: { status: 'ABANDONED' } });
  return res.body as { id: string; reference: string };
}

async function race(cardStatus: 'PENDING' | 'ABANDONED') {
  const seen = { cashWon: 0, cardWon: 0 };
  for (let round = 1; round <= ROUNDS; round++) {
    const tk = await makeTicket(t);
    const card = await cardPayment(tk.id, cardStatus);
    // The webhook needs no sign-in and is faster than a cash request, so it is
    // started 0-45 ms late, by round: both orders happen across the rounds.
    const lag = (round % 10) * 5;
    const [cash, hook] = await Promise.all([
      as(t, t.users.booth.id, 'POST', '/payments/cash', { ticketId: tk.id, idempotencyKey: newKey() }),
      new Promise((r) => setTimeout(r, lag)).then(() =>
        postWebhook(t.url, { event: 'charge.success', data: successData({ reference: card.reference, amountKobo: tk.feeKobo }) }),
      ),
    ]);
    assert.equal(hook.status, 200, `round ${round}: webhook ${hook.status}`);
    assert.ok([201, 409].includes(cash.status), `round ${round}: cash answered ${cash.status} ${JSON.stringify(cash.body)}`);

    const payments = await t.prisma.payment.findMany({ where: { ticketId: tk.id } });
    const success = payments.filter((p) => p.status === 'SUCCESS');
    assert.equal(success.length, 1, `round ${round}: ${success.length} SUCCESS payments`);
    const ticket = await t.prisma.ticket.findUniqueOrThrow({ where: { id: tk.id } });
    assert.equal(ticket.paymentStatus, 'PAID');
    assert.equal(ticket.paidPaymentId, success[0].id, `round ${round}: the ticket points at another payment`);

    const cardRow = payments.find((p) => p.id === card.id)!;
    if (cash.status === 201) {
      seen.cashWon++;
      assert.equal(success[0].method, 'CASH');
      assert.equal(cardRow.status, 'DUPLICATE', `round ${round}: card after cash should be DUPLICATE`);
    } else {
      seen.cardWon++;
      assert.match(cash.body.message, /already paid|in progress/i);
      assert.equal(success[0].id, card.id);
    }
  }
  return seen;
}

test(`cash vs card SUCCESS for one ticket at once, card ABANDONED before: one SUCCESS, ${ROUNDS} rounds`, async () => {
  const seen = await race('ABANDONED');
  // Not an assertion on timing, a record of what the rounds exercised.
  console.log(`ABANDONED variant: cash won ${seen.cashWon}, card won ${seen.cardWon}`);
});

test(`cash vs card SUCCESS for one ticket at once, card PENDING: one SUCCESS, ${ROUNDS} rounds`, async () => {
  const seen = await race('PENDING');
  console.log(`PENDING variant: cash won ${seen.cashWon}, card won ${seen.cardWon}`);
});
