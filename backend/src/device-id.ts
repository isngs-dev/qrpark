import { BadRequestException } from '@nestjs/common';

/**
 * The app's installation id (X-Device-Id). Recorded as device_ref on
 * tickets, payments and scans; never trusted (there is no device registry).
 * Moved here from scans.controller.ts so every route that needs it shares one
 * rule.
 */
export const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function deviceRef(header: string | undefined): string {
  // Never echo the header value: it is whatever the client sent.
  if (typeof header !== 'string' || !DEVICE_ID.test(header)) {
    throw new BadRequestException('The X-Device-Id header is missing or invalid');
  }
  return header;
}
