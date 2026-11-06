import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * HTTP setup shared by main.ts and the tests, so what is tested is what runs.
 *
 * Called before app.init() / listen(): Nest registers its own JSON and
 * urlencoded parsers at init, so anything mounted here runs first.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;

  // Exactly one proxy hop is trusted: Render's. req.ip is then the address
  // Render saw, and req.protocol is what the client used. Trusting more hops
  // would let a client choose its own address with an X-Forwarded-For header.
  express.set('trust proxy', 1);
}
