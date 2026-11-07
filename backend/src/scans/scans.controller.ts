import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { deviceRef } from '../device-id';
import { ScansService } from './scans.service';

/**
 * Validation messages name the field, never its value: nothing in a 400
 * here echoes the scanned token.
 */
class ScanDto {
  @IsString({ message: 'token must be text' })
  @MaxLength(2048, { message: 'token is too long' })
  token!: string;
}

/** Exit validation and the read-only check. See docs/api.md, "Scans". */
@Controller('tickets')
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  @Roles('EXIT_OPERATOR')
  @Post('validate')
  @HttpCode(200)
  validate(@Body() body: ScanDto, @Headers('x-device-id') device: string | undefined, @CurrentActor() actor: Actor) {
    return this.scans.validate(actor, body.token, deviceRef(device));
  }

  @Roles('ENTRY_OPERATOR', 'PAYMENT_OPERATOR', 'EXIT_OPERATOR')
  @Post('check')
  @HttpCode(200)
  check(@Body() body: ScanDto, @Headers('x-device-id') device: string | undefined, @CurrentActor() actor: Actor) {
    return this.scans.check(actor, body.token, deviceRef(device));
  }
}
