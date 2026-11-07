import { ConflictException, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, type GateDirection } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { AuditService, changes } from '../audit/audit.service';
import { paystackMode } from '../paystack/verdicts';
import {
  assertCode,
  assertPaymentWindow,
  assertPriceKobo,
  cleanDisplayName,
  cleanName,
  cleanReceiptLine,
} from './config-rules';

/**
 * Vehicle categories and prices, site settings, and gates. ADMIN only (the
 * controller says so).
 *
 * Copied from eparking backend/src/config/config.service.ts and adapted:
 * categories carry a flat price, settings are the site_setting row, and
 * EVERY change is audited in the same transaction as the change.
 */

const CATEGORY = { id: true, code: true, name: true, priceKobo: true, isActive: true, createdAt: true, updatedAt: true } as const;
const GATE = { id: true, code: true, name: true, direction: true, isActive: true, createdAt: true, updatedAt: true } as const;
const SETTINGS = {
  displayName: true,
  paymentWindowMinutes: true,
  receiptOrgName: true,
  receiptContactLine: true,
  updatedAt: true,
} as const;

/** Read-only in the portal: from the environment, never stored. */
const withMode = <T extends object>(settings: T) => ({ ...settings, paystackMode: paystackMode(process.env.PAYSTACK_SECRET_KEY) });

/** A unique-key clash becomes 409 with a plain message. */
function conflictOn(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException(message);
  }
  throw error;
}

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ categories

  async listCategories() {
    const siteId = await this.site.getId();
    return this.prisma.vehicleCategory.findMany({
      where: { siteId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: CATEGORY,
    });
  }

  async createCategory(input: { code: string; name: string; priceKobo: number }, actorId: string) {
    const siteId = await this.site.getId();
    const code = assertCode(input.code, 'category');
    const name = cleanName(input.name, 'category');
    assertPriceKobo(input.priceKobo);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.vehicleCategory.create({
          data: { siteId, code, name, priceKobo: input.priceKobo },
          select: CATEGORY,
        });
        await this.audit.record({
          client: tx,
          actorId,
          action: 'CATEGORY_CREATED',
          targetType: 'vehicle_category',
          targetId: created.id,
          detail: { code, name, priceKobo: created.priceKobo },
        });
        return created;
      });
    } catch (error) {
      conflictOn(error, `A category with code "${code}" already exists`);
    }
  }

  /**
   * Rename, set the price, or (de)activate. The code never changes: the app
   * sends it. A price change is its own audit action, because it decides
   * what everyone who arrives next pays; a payment already started keeps its
   * snapshot.
   */
  async updateCategory(
    id: string,
    input: { name?: string; priceKobo?: number; isActive?: boolean },
    actorId: string,
  ) {
    const siteId = await this.site.getId();
    const data: { name?: string; priceKobo?: number; isActive?: boolean } = {};
    if (input.name !== undefined) data.name = cleanName(input.name, 'category');
    if (input.priceKobo !== undefined) {
      assertPriceKobo(input.priceKobo);
      data.priceKobo = input.priceKobo;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.vehicleCategory.findFirst({ where: { id, siteId }, select: CATEGORY });
      if (!before) throw new NotFoundException('Unknown vehicle category at this site');

      const after = await tx.vehicleCategory.update({ where: { id }, data, select: CATEGORY });

      const price = changes(before, after, ['priceKobo']);
      const other = changes(before, after, ['name', 'isActive']);
      if (Object.keys(price).length === 0 && Object.keys(other).length === 0) {
        throw new BadRequestException('Nothing to change');
      }
      if (Object.keys(price).length > 0) {
        await this.audit.record({
          client: tx,
          actorId,
          action: 'CATEGORY_PRICE_CHANGED',
          targetType: 'vehicle_category',
          targetId: id,
          detail: { code: after.code, ...price },
        });
      }
      if (Object.keys(other).length > 0) {
        await this.audit.record({
          client: tx,
          actorId,
          action: 'CATEGORY_UPDATED',
          targetType: 'vehicle_category',
          targetId: id,
          detail: { code: after.code, ...other },
        });
      }
      return after;
    });
  }

  // -------------------------------------------------------------- settings

  async getSettings() {
    const siteId = await this.site.getId();
    const settings = await this.prisma.siteSetting.findUnique({ where: { siteId }, select: SETTINGS });
    if (!settings) throw new NotFoundException('This site has no settings row. Run: npm run seed:site');
    return withMode(settings);
  }

  /**
   * Change the payment window, the display name or the receipt lines. There
   * is no validity setting: a ticket is valid on its day of issue.
   */
  async updateSettings(
    input: {
      displayName?: string;
      paymentWindowMinutes?: number;
      receiptOrgName?: string | null;
      receiptContactLine?: string | null;
    },
    actorId: string,
  ) {
    const siteId = await this.site.getId();
    const data: {
      displayName?: string;
      paymentWindowMinutes?: number;
      receiptOrgName?: string | null;
      receiptContactLine?: string | null;
    } = {};
    if (input.displayName !== undefined) data.displayName = cleanDisplayName(input.displayName);
    if (input.paymentWindowMinutes !== undefined) {
      assertPaymentWindow(input.paymentWindowMinutes);
      data.paymentWindowMinutes = input.paymentWindowMinutes;
    }
    if (input.receiptOrgName !== undefined) data.receiptOrgName = cleanReceiptLine(input.receiptOrgName, 'receiptOrgName');
    if (input.receiptContactLine !== undefined) {
      data.receiptContactLine = cleanReceiptLine(input.receiptContactLine, 'receiptContactLine');
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change');

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.siteSetting.findUnique({ where: { siteId }, select: SETTINGS });
      if (!before) throw new NotFoundException('This site has no settings row. Run: npm run seed:site');
      const after = await tx.siteSetting.update({ where: { siteId }, data, select: SETTINGS });

      const changed = changes(before, after, Object.keys(data));
      if (Object.keys(changed).length > 0) {
        await this.audit.record({
          client: tx,
          actorId,
          action: 'SETTINGS_CHANGED',
          targetType: 'site_setting',
          targetId: siteId,
          detail: changed,
        });
      }
      return withMode(after);
    });
  }

  // ----------------------------------------------------------------- gates

  async listGates() {
    const siteId = await this.site.getId();
    return this.prisma.gate.findMany({
      where: { siteId },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      select: GATE,
    });
  }

  async createGate(input: { code: string; name: string; direction: GateDirection }, actorId: string) {
    const siteId = await this.site.getId();
    const code = assertCode(input.code, 'gate');
    const name = cleanName(input.name, 'gate');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.gate.create({
          data: { siteId, code, name, direction: input.direction },
          select: GATE,
        });
        await this.audit.record({
          client: tx,
          actorId,
          action: 'GATE_CREATED',
          targetType: 'gate',
          targetId: created.id,
          detail: { code, name, direction: created.direction },
        });
        return created;
      });
    } catch (error) {
      conflictOn(error, `A gate with code "${code}" already exists`);
    }
  }

  /** Rename or take out of service. Code and direction never change. */
  async updateGate(id: string, input: { name?: string; isActive?: boolean }, actorId: string) {
    const siteId = await this.site.getId();
    const data: { name?: string; isActive?: boolean } = {};
    if (input.name !== undefined) data.name = cleanName(input.name, 'gate');
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.gate.findFirst({ where: { id, siteId }, select: GATE });
      if (!before) throw new NotFoundException('Unknown gate at this site');
      const after = await tx.gate.update({ where: { id }, data, select: GATE });

      const changed = changes(before, after, ['name', 'isActive']);
      if (Object.keys(changed).length === 0) throw new BadRequestException('Nothing to change');
      await this.audit.record({
        client: tx,
        actorId,
        action: 'GATE_UPDATED',
        targetType: 'gate',
        targetId: id,
        detail: { code: after.code, ...changed },
      });
      return after;
    });
  }
}
