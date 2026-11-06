import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentActor, Roles, type Actor } from '../auth/auth.guard';
import { ScansService } from './scans.service';

/** The app's installation id. Recorded as scan_event.device_ref; never trusted. */
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validation messages name the field, never its value: nothing in a 400
 * here echoes the scanned token.
 */
class ScanDto {
  @IsString({ message: 'token must be text' })
  @MaxLength(2048, { message: 'token is too long' })
  token!: string;
}

function deviceRef(header: string | undefined): string {
  // Never echo the header value: it is whatever the client sent.
  if (typeof header !== 'string' || !DEVICE_ID.test(header)) {
    throw new BadRequestException('The X-Device-Id header is missing or invalid');
  }
  return header;
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

  @Roles('ENTRY_OPERATOR', 'EXIT_OPERATOR')
  @Post('check')
  @HttpCode(200)
  check(@Body() body: ScanDto, @Headers('x-device-id') device: string | undefined, @CurrentActor() actor: Actor) {
    return this.scans.check(actor, body.token, deviceRef(device));
  }
}
