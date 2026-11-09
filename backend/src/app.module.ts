import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { CoreModule } from './core.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { ConfigController } from './config/config.controller';
import { ConfigService as SiteConfigService } from './config/config.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { LockService } from './lock/lock.service';
import { HttpPaystackGateway, PaystackGateway } from './paystack/paystack.gateway';
import { PaystackController } from './paystack/paystack.controller';
import { assertNotLiveKey } from './paystack/verdicts';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { SettlementService } from './payments/settlement.service';
import { ReconciliationService } from './jobs/reconciliation.service';
import { TicketIssuer } from './tickets/ticket-issuer';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';
import { ScanStore } from './scans/scan-store';
import { ScansController } from './scans/scans.controller';
import { ScansService } from './scans/scans.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CoreModule, AuthModule],
  controllers: [
    HealthController,
    ConfigController,
    UsersController,
    PaymentsController,
    PaystackController,
    TicketsController,
    ScansController,
    ReportsController,
  ],
  providers: [
    ReportsService,
    SiteConfigService,
    UsersService,
    LockService,
    // Test keys only until go-live: a live key stops the app from starting.
    {
      provide: PaystackGateway,
      useFactory: () => {
        assertNotLiveKey(process.env.PAYSTACK_SECRET_KEY);
        return new HttpPaystackGateway();
      },
    },
    SettlementService,
    PaymentsService,
    ReconciliationService,
    TicketIssuer,
    TicketsService,
    ScanStore,
    ScansService,
    // Every endpoint is authenticated and role-checked unless it opts out
    // with @Public(). Enforced here, not in any client.
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        // Unknown fields are refused, not ignored: a mistyped "price" must
        // not look like a successful edit, and a client-sent timestamp never
        // reaches a service.
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
