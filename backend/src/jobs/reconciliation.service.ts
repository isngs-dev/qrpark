import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { SettlementService } from '../payments/settlement.service';

/**
 * Two background jobs, both of which change a payment ONLY from Paystack's
 * answer (SettlementService.verifyAndApply):
 *
 *   verify   one delayed check after a payment starts: ~20 s, for a webhook
 *            that never came; ~3 s when Paystack did not answer at all.
 *   sweep    every 2 minutes, every PENDING payment older than 20 s, so a
 *            lost webhook resolves and an unpaid one is ABANDONED once past
 *            the payment window.
 *
 * Adapted from eparking backend/src/jobs/reconciliation.service.ts.
 * DISABLE_JOBS=1 turns the queue off (tests, scripts); the methods still work
 * when called directly.
 *
 * Redis must run with maxmemory-policy noeviction (docs/05-known-issues.md L3).
 */

export const VERIFY_FALLBACK_MS = 20_000;
export const VERIFY_SOON_MS = 3_000;
const SWEEP_EVERY_MS = 2 * 60_000;
const QUEUE = 'qrpark-payments';

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly settlement: SettlementService,
  ) {}

  private connection(): ConnectionOptions {
    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      // BullMQ workers require this.
      maxRetriesPerRequest: null,
    };
  }

  async onModuleInit() {
    if (process.env.DISABLE_JOBS === '1') {
      this.logger.log('Background jobs disabled (DISABLE_JOBS=1)');
      return;
    }
    const connection = this.connection();
    this.queue = new Queue(QUEUE, { connection });
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'verify') return this.verifyOne(job.data.reference as string);
        if (job.name === 'sweep') return this.sweep();
        return undefined;
      },
      { connection },
    );
    this.worker.on('failed', (job, error) => this.logger.error(`Job ${job?.name} failed: ${error.message}`));
    await this.queue.upsertJobScheduler(
      'payment-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep', opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
    this.logger.log('Payment reconciliation worker started');
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  /**
   * Schedule a verify. NEVER throws: by now the payment exists and may be in
   * the customer's hands; the sweep still picks it up if scheduling fails.
   */
  async scheduleVerify(reference: string, delayMs: number = VERIFY_FALLBACK_MS): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(
        'verify',
        { reference },
        { delay: delayMs, removeOnComplete: true, removeOnFail: 50, jobId: `verify-${delayMs}-${reference}` },
      );
    } catch (error) {
      this.logger.error(`Could not schedule a verify for ${reference}: ${(error as Error).message}. The sweep will pick it up.`);
    }
  }

  async verifyOne(reference: string): Promise<void> {
    await this.settlement.verifyAndApply(reference);
  }

  /** Every PENDING payment older than the fallback, oldest first, one at a time. */
  async sweep(): Promise<void> {
    const siteId = await this.site.getId();
    const stale = await this.prisma.payment.findMany({
      where: { siteId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - VERIFY_FALLBACK_MS) } },
      orderBy: { createdAt: 'asc' },
      select: { reference: true },
      take: 200,
    });
    for (const { reference } of stale) {
      try {
        await this.settlement.verifyAndApply(reference);
      } catch (error) {
        this.logger.error(`Sweep could not check ${reference}: ${(error as Error).message}`);
      }
    }
  }
}
