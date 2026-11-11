import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';

/** Express's default JSON limit, kept. */
const JSON_LIMIT = '100kb';

/**
 * HTTP setup shared by main.ts and the tests, so what is tested is what runs.
 *
 * Called before app.init() / listen(): Nest registers its own JSON and
 * urlencoded parsers at init, so anything mounted here runs first.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;

  // Exactly one proxy hop is trusted: Caddy's (compose.prod.yml; nothing else
  // can reach the api). req.ip is then the address Caddy saw, and req.protocol
  // is what the client used. Trusting more hops
  // would let a client choose its own address with an X-Forwarded-For header.
  express.set('trust proxy', 1);

  // Our own JSON parser, ahead of Nest's, for one reason: when a body is not
  // valid JSON the default 400 quotes the start of it ("Unexpected token 's',
  // "slV2_VZ5vT"... is not valid JSON"), which for a scan is part of the QR
  // token. This answers with a fixed message instead. It keeps the exact
  // bytes on req.rawBody, as Nest's rawBody option does, because the Paystack
  // signature is checked over them. Nest's parser then sees the body already
  // read and skips it.
  const parse = json({
    limit: JSON_LIMIT,
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  });
  express.use((req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error?: unknown) => {
      if (!error) return next();
      const status = (error as { status?: number }).status ?? 400;
      res.status(status).json({
        statusCode: status,
        message: status === 413 ? 'The request body is too large' : 'The request body is not valid JSON',
        error: status === 413 ? 'Payload Too Large' : 'Bad Request',
      });
    });
  });
}
