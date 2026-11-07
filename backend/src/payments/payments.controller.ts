import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { deviceRef } from '../device-id';
import { PaymentsService } from './payments.service';
import { IDEMPOTENCY_KEY_PATTERN } from './idempotency';

/**
 * Payment operators at a booth: cash, card, and polling a card payment.
 * See docs/api.md, "Booth". Messages name fields, never their values: no 400
 * here echoes a scanned token.
 */

class BoothPaymentDto {
  @ValidateIf((o: BoothPaymentDto) => o.token !== undefined)
  @IsString({ message: 'token must be text' }) @MaxLength(2048, { message: 'token is too long' })
  token?: string;

  @ValidateIf((o: BoothPaymentDto) => o.ticketId !== undefined)
  @IsString({ message: 'ticketId must be text' }) @MaxLength(64, { message: 'ticketId is too long' })
  ticketId?: string;

  @IsString() @Matches(IDEMPOTENCY_KEY_PATTERN, { message: 'idempotencyKey must be 16-100 of A-Z a-z 0-9 _ -' })
  idempotencyKey!: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** 201 for a new payment, 200 for a repeat of the same idempotency key. */
  @Roles('PAYMENT_OPERATOR')
  @Post('cash')
  async cash(
    @Body() body: BoothPaymentDto,
    @Headers('x-device-id') device: string | undefined,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, payment } = await this.payments.cash(actor, body, deviceRef(device));
    res.status(created ? 201 : 200);
    return payment;
  }

  /** 201 for a new payment, 200 for a repeat of the same idempotency key. */
  @Roles('PAYMENT_OPERATOR')
  @Post('card')
  async card(
    @Body() body: BoothPaymentDto,
    @Headers('x-device-id') device: string | undefined,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, payment } = await this.payments.startCard(actor, body, deviceRef(device));
    res.status(created ? 201 : 200);
    return payment;
  }

  @Roles('PAYMENT_OPERATOR')
  @Get(':id')
  get(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.payments.get(actor, id);
  }
}
