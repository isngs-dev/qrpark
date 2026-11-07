import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsString, Matches, MaxLength } from 'class-validator';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { deviceRef } from '../device-id';
import { IDEMPOTENCY_KEY_PATTERN } from '../payments/idempotency';
import { TicketsService } from './tickets.service';

class CreateTicketDto {
  @IsString() @MaxLength(32)
  categoryCode!: string;

  @IsString() @Matches(IDEMPOTENCY_KEY_PATTERN, { message: 'idempotencyKey must be 16-100 of A-Z a-z 0-9 _ -' })
  idempotencyKey!: string;
}

class ReprintDto {
  @IsString() @MaxLength(64)
  ticketId!: string;
}

/** Entry: categories, create, recent, lookup, reprint. See docs/api.md, "Entry". */
@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Roles('ENTRY_OPERATOR')
  @Get('categories')
  categories() {
    return this.tickets.categories();
  }

  /** 201 for a new ticket, 200 for a repeat of the same idempotency key. */
  @Roles('ENTRY_OPERATOR')
  @Post('tickets')
  async create(
    @Body() body: CreateTicketDto,
    @Headers('x-device-id') device: string | undefined,
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, ticket } = await this.tickets.create(actor, body, deviceRef(device));
    res.status(created ? 201 : 200);
    return ticket;
  }

  @Roles('ENTRY_OPERATOR')
  @Get('tickets/recent')
  recent(@CurrentActor() actor: Actor) {
    return this.tickets.recent(actor);
  }

  @Roles('ENTRY_OPERATOR', 'PAYMENT_OPERATOR')
  @Get('tickets/lookup')
  lookup(@Query('suffix') suffix: unknown) {
    return this.tickets.lookup(suffix);
  }

  @Roles('ENTRY_OPERATOR')
  @Post('tickets/reprint')
  @HttpCode(200)
  reprint(@Body() body: ReprintDto, @CurrentActor() actor: Actor) {
    return this.tickets.reprint(actor, body.ticketId);
  }
}
