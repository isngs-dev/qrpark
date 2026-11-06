import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength, ValidateIf } from 'class-validator';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { TicketsService } from './tickets.service';

class ReprintDto {
  @ValidateIf((o: ReprintDto) => o.ticketId !== undefined) @IsString() @MaxLength(64)
  ticketId?: string;

  @ValidateIf((o: ReprintDto) => o.ticketNumber !== undefined) @IsString() @MaxLength(32)
  ticketNumber?: string;
}

/** Entry operators: recent tickets and reprints. See docs/api.md, "Tickets". */
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Roles('ENTRY_OPERATOR')
  @Get('recent')
  recent(@CurrentActor() actor: Actor) {
    return this.tickets.recent(actor);
  }

  @Roles('ENTRY_OPERATOR')
  @Post('reprint')
  @HttpCode(200)
  reprint(@Body() body: ReprintDto, @CurrentActor() actor: Actor) {
    return this.tickets.reprint(actor, body);
  }
}
