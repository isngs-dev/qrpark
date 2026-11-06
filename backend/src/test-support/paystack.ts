import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  PaystackGateway,
  type InitializeRequest,
  type InitializeResult,
  type VerifyResult,
} from '../paystack/paystack.gateway';

/**
 * A fake Paystack for every test. Installed over the app's own gateway
 * instance, so the services under test hold the fake; nothing can reach the
 * network. Webhooks are signed with the per-run sk_test_ value that
 * bootTestApp puts in PAYSTACK_SECRET_KEY.
 */

export interface FakePaystack {
  initCalls: InitializeRequest[];
  verifyCalls: string[];
  /** What the next initialize returns. Default: accepted, with a checkout. */
  onInitialize: (request: InitializeRequest) => InitializeResult;
  /** Per-reference verify answers. Default: pending. */
  verifyAnswers: Map<string, VerifyResult>;
  configured: boolean;
}

export const CHECKOUT_PREFIX = 'https://checkout.paystack.test/';

export function acceptedInit(request: InitializeRequest): InitializeResult {
  return {
    outcome: 'accepted',
    authorizationUrl: `${CHECKOUT_PREFIX}${request.reference}`,
    accessCode: `ac_${request.reference.slice(-8)}`,
    message: 'ok',
  };
}

export function installFakePaystack(app: INestApplication): FakePaystack {
  const gateway = app.get(PaystackGateway);
  const fake: FakePaystack = {
    initCalls: [],
    verifyCalls: [],
    onInitialize: acceptedInit,
    verifyAnswers: new Map(),
    configured: true,
  };
  gateway.isConfigured = () => fake.configured;
  gateway.initialize = async (request) => {
    fake.initCalls.push(request);
    return fake.onInitialize(request);
  };
  gateway.verify = async (reference) => {
    fake.verifyCalls.push(reference);
    return fake.verifyAnswers.get(reference) ?? { kind: 'pending', data: null, message: 'ongoing' };
  };
  return fake;
}

/**
 * What Paystack sends for a successful charge, card details included, so
 * tests can prove none of it reaches a log line.
 */
export function successData(payment: { reference: string; amountKobo: number }, overrides: Record<string, unknown> = {}) {
  return {
    reference: payment.reference,
    amount: payment.amountKobo,
    currency: 'NGN',
    status: 'success',
    paid_at: '2026-11-06T09:58:01.000Z',
    channel: 'card',
    authorization: { last4: '4081', bin: '408408', card_type: 'visa', authorization_code: 'AUTH_secret123' },
    customer: { email: 'walkin@gsds.com.ng' },
    ...overrides,
  };
}

/** POST /paystack/webhook with the exact bytes signed (or a bad signature). */
export async function postWebhook(
  url: string,
  body: unknown,
  options: { signature?: string | null } = {},
): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify(body);
  const secret = process.env.PAYSTACK_SECRET_KEY ?? '';
  const signature =
    options.signature === undefined ? createHmac('sha512', secret).update(raw).digest('hex') : options.signature;
  const res = await fetch(`${url}/paystack/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature !== null ? { 'x-paystack-signature': signature } : {}),
    },
    body: raw,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}
