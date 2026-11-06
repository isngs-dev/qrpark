import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { PaymentsService } from './payments.service';
import { IDEMPOTENCY_KEY_PATTERN } from './idempotency';

/** Entry operators: the category list, starting a payment, and polling it. See docs/api.md. */

class StartPaymentDto {
  @IsString() @MaxLength(32)
  categoryCode!: string;

  @ValidateIf((o: StartPaymentDto) => o.customerName !== undefined && o.customerName !== null)
  @IsString() @MaxLength(200)
  customerName?: string | null;

  @IsString() @Matches(IDEMPOTENCY_KEY_PATTERN, { message: 'idempotencyKey must be 16-100 of A-Z a-z 0-9 _ -' })
  idempotencyKey!: string;
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Roles('ENTRY_OPERATOR')
  @Get('categories')
  categories() {
    return this.payments.categories();
  }

  /** 201 for a new payment, 200 for a repeat of the same idempotency key. */
  @Roles('ENTRY_OPERATOR')
  @Post('payments')
  async start(
    @Body() body: StartPaymentDto,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, payment } = await this.payments.start(actor, body);
    res.status(created ? 201 : 200);
    return payment;
  }

  @Roles('ENTRY_OPERATOR')
  @Get('payments/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentActor() actor: Actor) {
    return this.payments.get(actor, id);
  }
}
