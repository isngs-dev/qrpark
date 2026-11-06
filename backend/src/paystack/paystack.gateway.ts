import { Injectable, Logger } from '@nestjs/common';

/**
 * The two calls this app makes to Paystack: start a checkout, and ask how a
 * transaction stands. Behind an abstract class so the payment adapter can
 * change (Paystack Terminal later) and so tests use a fake: no test and no CI
 * run ever reaches Paystack.
 *
 * Adapted from eparking backend/src/payments/terminal.ts (initialize, the
 * accepted / refused / unknown split) and backend/src/paystack/paystack.service.ts
 * (verify). Uses global fetch: two HTTP calls do not justify an SDK.
 *
 * NOTHING HERE IS LOGGED but the reference and a short reason: never the
 * payload, card data, authorization_url or access_code.
 */

export interface InitializeRequest {
  reference: string;
  amountKobo: number;
  email: string;
}

/**
 * accepted  Paystack created the transaction; here is the checkout.
 * refused   a clear, well-formed "no": no charge exists and none can appear.
 * unknown   timeout, network failure, 5xx or an unreadable answer. Paystack
 *           MAY have created it. Never treated as a refusal.
 */
export interface InitializeResult {
  outcome: 'accepted' | 'refused' | 'unknown';
  authorizationUrl: string | null;
  accessCode: string | null;
  message: string;
}

/**
 * success / failed / abandoned / pending: Paystack answered with that status
 *   ("pending" covers ongoing, processing, queued and anything else unpaid).
 * not_found: Paystack has no such transaction.
 * unknown: we got no answer we can trust. Changes nothing.
 */
export interface VerifyResult {
  kind: 'success' | 'failed' | 'abandoned' | 'pending' | 'not_found' | 'unknown';
  data: Record<string, unknown> | null;
  message: string;
}

export abstract class PaystackGateway {
  abstract isConfigured(): boolean;
  abstract initialize(request: InitializeRequest): Promise<InitializeResult>;
  abstract verify(reference: string): Promise<VerifyResult>;
}

const PAYSTACK_API = 'https://api.paystack.co';

/** Bounded, so a hung connection resolves as unknown instead of holding the lock. */
const TIMEOUT_MS = 15_000;

@Injectable()
export class HttpPaystackGateway extends PaystackGateway {
  private readonly logger = new Logger(HttpPaystackGateway.name);

  private get secretKey(): string | undefined {
    return process.env.PAYSTACK_SECRET_KEY?.trim() || undefined;
  }

  isConfigured(): boolean {
    return this.secretKey !== undefined;
  }

  async initialize(request: InitializeRequest): Promise<InitializeResult> {
    const unknown = (message: string): InitializeResult => {
      this.logger.error(`Initialize outcome UNKNOWN for ${request.reference}: ${message}. It will be verified.`);
      return { outcome: 'unknown', authorizationUrl: null, accessCode: null, message };
    };

    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.secretKey ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: request.email,
          // Paystack takes minor units, which is what we store.
          amount: request.amountKobo,
          currency: 'NGN',
          reference: request.reference,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return unknown(`request failed (${(error as Error).name})`);
    }
    if (response.status >= 500) return unknown(`HTTP ${response.status}`);

    let body: { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string } };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return unknown('unreadable response');
    }

    if (body.status === false) {
      this.logger.error(`Paystack refused to initialize ${request.reference}`);
      return { outcome: 'refused', authorizationUrl: null, accessCode: null, message: body.message ?? 'refused' };
    }
    if (body.status !== true) return unknown('unexpected response shape');

    return {
      outcome: 'accepted',
      authorizationUrl: body.data?.authorization_url ?? null,
      accessCode: body.data?.access_code ?? null,
      message: 'ok',
    };
  }

  async verify(reference: string): Promise<VerifyResult> {
    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${this.secretKey ?? ''}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'unknown', data: null, message: `request failed (${(error as Error).name})` };
    }
    if (response.status >= 500) return { kind: 'unknown', data: null, message: `HTTP ${response.status}` };

    let body: { status?: boolean; message?: string; data?: Record<string, unknown> };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { kind: 'unknown', data: null, message: 'unreadable response' };
    }

    if (body.status === true && body.data) {
      // Answer only for the reference we asked about.
      if (body.data.reference !== reference) return { kind: 'unknown', data: null, message: 'reference mismatch' };
      const status = body.data.status;
      if (status === 'success') return { kind: 'success', data: body.data, message: 'success' };
      if (status === 'failed') return { kind: 'failed', data: body.data, message: 'failed' };
      if (status === 'abandoned') return { kind: 'abandoned', data: body.data, message: 'abandoned' };
      return { kind: 'pending', data: body.data, message: String(status) };
    }
    if (body.status === false && /not found/i.test(body.message ?? '')) {
      return { kind: 'not_found', data: null, message: 'not found' };
    }
    return { kind: 'unknown', data: null, message: 'unexpected response shape' };
  }
}
