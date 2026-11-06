import { Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.guard';
import { SettlementService } from '../payments/settlement.service';
import { isValidPaystackSignature } from './paystack.signature';

/**
 * Paystack's webhook. Adapted from eparking backend/src/paystack/paystack.controller.ts;
 * the verify and lookup routes are not carried over (the jobs verify).
 */
@Controller('paystack')
export class PaystackController {
  constructor(private readonly settlement: SettlementService) {}

  // Paystack cannot present a JWT. The signature IS the authentication.
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    // Signature first, over the exact bytes received, before anything in the
    // body is read. A bad or missing signature changes nothing.
    if (!isValidPaystackSignature(request.rawBody, signature, process.env.PAYSTACK_SECRET_KEY?.trim())) {
      throw new UnauthorizedException('Invalid Paystack signature');
    }

    const event = request.body as { event?: unknown; data?: Record<string, unknown> } | undefined;
    const data = event?.data;
    const reference = data?.reference;
    if (!data || typeof reference !== 'string') return { received: true };

    if (event?.event === 'charge.success') {
      await this.settlement.settleSuccess(reference, data, 'webhook');
    } else if (event?.event === 'charge.failed') {
      await this.settlement.markFailed(reference, data);
    }
    // 200 once the signature checks out, whatever happened, so Paystack stops
    // retrying. An unknown reference changes nothing.
    return { received: true };
  }
}
