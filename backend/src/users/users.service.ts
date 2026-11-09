import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { AuthService } from '../auth/auth.service';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { AuditService, changes } from '../audit/audit.service';
import {
  assertGateForRole,
  assertNotLastAdmin,
  assertNotSelfLockout,
  assertPassword,
  endsSessions,
  normaliseUsername,
  planUserUpdate,
  type UserUpdate,
} from './user-rules';

/**
 * User accounts. ADMIN only (the controller says so).
 *
 * Copied from eparking backend/src/staff/staff.service.ts and adapted:
 * usernames, a gate for every operator, password resets audited, and
 * token_version raised by every change that should end a session.
 *
 * A password is set, never read: password_hash is outside every response
 * shape here, so there is no path by which it can be returned.
 */

const VIEW = {
  id: true,
  username: true,
  name: true,
  role: true,
  isActive: true,
  gate: { select: { id: true, code: true, name: true, direction: true } },
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottleService,
  ) {}

  async list() {
    const siteId = await this.site.getId();
    return this.prisma.appUser.findMany({
      where: { siteId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { username: 'asc' }],
      select: VIEW,
    });
  }

  async get(id: string) {
    const siteId = await this.site.getId();
    const user = await this.prisma.appUser.findFirst({ where: { id, siteId, deletedAt: null }, select: VIEW });
    if (!user) throw new NotFoundException('Unknown user at this site');
    return user;
  }

  private async gateAt(siteId: string, gateId: string | null | undefined) {
    if (gateId === null || gateId === undefined) return null;
    const gate = await this.prisma.gate.findFirst({
      where: { id: gateId, siteId },
      select: { id: true, code: true, direction: true, isActive: true },
    });
    if (!gate) throw new BadRequestException('Unknown gate at this site');
    return gate;
  }

  /** The password is hashed with Argon2id before it touches the database. */
  async create(
    input: { username: string; name: string; role: UserRole; gateId?: string | null; password: string },
    actorId: string,
  ) {
    const siteId = await this.site.getId();
    const username = normaliseUsername(input.username);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A name cannot be blank');
    assertPassword(input.password);
    const gate = await this.gateAt(siteId, input.gateId);
    assertGateForRole(input.role, gate);

    const passwordHash = await AuthService.hash(input.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.appUser.create({
          data: { siteId, username, name, role: input.role, gateId: gate?.id ?? null, passwordHash },
          select: VIEW,
        });
        // Never the password, nor its hash.
        await this.audit.record({
          client: tx,
          actorId,
          action: 'USER_CREATED',
          targetType: 'app_user',
          targetId: user.id,
          detail: { username, role: user.role, gateCode: user.gate?.code ?? null },
        });
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`The username "${username}" is taken`);
      }
      throw error;
    }
  }

  /**
   * Rename, change role or gate, or (de)activate.
   *
   * The site's ADMIN rows are locked (FOR UPDATE) before the admin count is
   * read, so two admins deactivating each other at the same moment are
   * serialised: the second sees the first's change and is refused as the
   * last admin. Counting inside a plain READ COMMITTED transaction would let
   * both succeed and leave the site with nobody.
   */
  async update(id: string, input: UserUpdate, actorId: string) {
    const siteId = await this.site.getId();

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM app_user WHERE site_id = ${siteId}::uuid AND role = 'ADMIN' ORDER BY id FOR UPDATE`;

      const current = await tx.appUser.findFirst({
        where: { id, siteId, deletedAt: null },
        select: { id: true, username: true, name: true, role: true, gateId: true, isActive: true, gate: { select: { code: true } } },
      });
      if (!current) throw new NotFoundException('Unknown user at this site');

      // Promoting to ADMIN drops the gate unless one is named (and refused).
      const effective: UserUpdate = { ...input };
      if (input.role === UserRole.ADMIN && input.gateId === undefined) effective.gateId = null;

      const update = planUserUpdate(current, effective);
      assertNotSelfLockout(actorId, current, update);

      const role = update.role ?? current.role;
      const gateId = update.gateId !== undefined ? update.gateId : current.gateId;
      if (update.role !== undefined || update.gateId !== undefined) {
        assertGateForRole(role, await this.gateAt(siteId, gateId));
      }

      const otherActiveAdmins = await tx.appUser.count({
        where: { siteId, role: UserRole.ADMIN, isActive: true, deletedAt: null, id: { not: current.id } },
      });
      assertNotLastAdmin(current, update, otherActiveAdmins);

      const saved = await tx.appUser.update({
        where: { id },
        data: { ...update, ...(endsSessions(update) && { tokenVersion: { increment: 1 } }) },
        select: VIEW,
      });

      const before = { name: current.name, role: current.role, gateCode: current.gate?.code ?? null, isActive: current.isActive };
      const after = { name: saved.name, role: saved.role, gateCode: saved.gate?.code ?? null, isActive: saved.isActive };
      await this.audit.record({
        client: tx,
        actorId,
        action: 'USER_UPDATED',
        targetType: 'app_user',
        targetId: saved.id,
        detail: { username: saved.username, ...changes(before, after, ['name', 'role', 'gateCode', 'isActive']) },
      });
      return saved;
    });
  }

  /**
   * A SOFT delete (docs/api.md, "DELETE /admin/users/:id"): deleted_at set,
   * the account deactivated and its sessions ended at once (token_version);
   * its username freed for a new account (app_user_live_username_key covers
   * live accounts only); its history kept, so tickets, payments, scans and
   * audit rows still name it.
   *
   * Nobody deletes themselves. The last active admin cannot be deleted: the
   * site's ADMIN rows are locked first, as in update(), so two admins
   * deleting each other at the same moment are serialised and the second is
   * refused.
   */
  async remove(id: string, actorId: string) {
    const siteId = await this.site.getId();
    if (id === actorId) throw new BadRequestException('You cannot delete your own account');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM app_user WHERE site_id = ${siteId}::uuid AND role = 'ADMIN' ORDER BY id FOR UPDATE`;

      const current = await tx.appUser.findFirst({
        where: { id, siteId, deletedAt: null },
        select: { id: true, username: true, role: true, isActive: true },
      });
      if (!current) throw new NotFoundException('Unknown user at this site');

      if (current.role === UserRole.ADMIN && current.isActive) {
        const otherActiveAdmins = await tx.appUser.count({
          where: { siteId, role: UserRole.ADMIN, isActive: true, deletedAt: null, id: { not: current.id } },
        });
        if (otherActiveAdmins === 0) throw new BadRequestException('The last active admin cannot be deleted');
      }

      await tx.appUser.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, tokenVersion: { increment: 1 } },
      });
      await this.audit.record({
        client: tx,
        actorId,
        action: 'USER_DELETED',
        targetType: 'app_user',
        targetId: current.id,
        detail: { username: current.username, role: current.role },
      });
      return { id: current.id, deleted: true };
    });
  }

  /**
   * Set a new password. No old password: an admin resetting an operator has
   * none, which is why only ADMIN reaches this route. Ends the user's
   * sessions, and is audited (without the password).
   */
  async setPassword(id: string, password: string, actorId: string) {
    const siteId = await this.site.getId();
    assertPassword(password);
    const passwordHash = await AuthService.hash(password);

    const done = await this.prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findFirst({ where: { id, siteId, deletedAt: null }, select: { id: true, username: true } });
      if (!user) throw new NotFoundException('Unknown user at this site');
      await tx.appUser.update({
        where: { id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await this.audit.record({
        client: tx,
        actorId,
        action: 'USER_PASSWORD_RESET',
        targetType: 'app_user',
        targetId: user.id,
        detail: { username: user.username },
      });
      return { id: user.id, passwordSet: true, username: user.username };
    });
    // A new password is an exit from a sign-in block (Hardening H1).
    await this.throttle.clearUser(siteId, done.username);
    return { id: done.id, passwordSet: done.passwordSet };
  }
}
