import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // rawBody is required: the Paystack webhook signature (Sprint 2) is an HMAC
  // over the exact bytes Paystack sent. Re-serialising the parsed JSON would
  // change them and every signature check would fail.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
