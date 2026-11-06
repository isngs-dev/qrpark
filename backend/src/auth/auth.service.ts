import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import { USERNAME_PATTERN } from '../users/user-rules';

/**
 * Copied from eparking backend/src/auth/auth.service.ts and adapted:
 * username sign-in, three roles, the operator's gate in the response, and
 * logout through app_user.token_version.
 */

export interface TokenClaims {
  sub: string; // app_user.id
  siteId: string;
  role: UserRole;
  typ: 'access' | 'refresh';
  ver: number; // app_user.token_version when issued
}

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

/** One message for every sign-in failure, so it reveals nothing. */
const INVALID = 'Invalid username or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly jwt: JwtService,
  ) {}

  /** Argon2id. Never reversible, never logged. */
  static hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async login(rawUsername: string, password: string) {
    const siteId = await this.site.getId();
    const username = typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '';

    const user = USERNAME_PATTERN.test(username)
      ? await this.prisma.appUser.findUnique({ where: { siteId_username: { siteId, username } } })
      : null;

    // Verify against a dummy hash when the user does not exist, so the
    // response time does not reveal which usernames are registered.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!user || !ok || !user.isActive) {
      this.logger.warn(`Failed sign-in for username "${username}"`);
      throw new UnauthorizedException(INVALID);
    }

    return this.session(user.id);
  }

  async refresh(refreshToken: string) {
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (claims.typ !== 'refresh') throw new UnauthorizedException('Not a refresh token');

    // Re-read the user: deactivation, logout and role or gate changes must
    // stop a refresh at once, not when the token happens to expire.
    const user = await this.prisma.appUser.findUnique({ where: { id: claims.sub } });
    if (
      !user ||
      !user.isActive ||
      user.tokenVersion !== claims.ver ||
      user.siteId !== (await this.site.getId())
    ) {
      throw new UnauthorizedException('Session has ended; sign in again');
    }

    return this.session(user.id);
  }

  /**
   * Ends every session of this user: raises token_version, so every access
   * and refresh token issued before now is refused on its next use.
   */
  async logout(userId: string): Promise<void> {
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  /** Tokens plus what the app needs to open: the user, the gate, the site. */
  private async session(userId: string) {
    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        siteId: true,
        username: true,
        name: true,
        role: true,
        tokenVersion: true,
        gate: { select: { id: true, code: true, name: true, direction: true } },
        site: { select: { code: true, setting: { select: { displayName: true } } } },
      },
    });

    const base = { sub: user.id, siteId: user.siteId, role: user.role, ver: user.tokenVersion };
    return {
      accessToken: this.jwt.sign({ ...base, typ: 'access' }, { expiresIn: ACCESS_TTL }),
      refreshToken: this.jwt.sign({ ...base, typ: 'refresh' }, { expiresIn: REFRESH_TTL }),
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
      gate: user.gate,
      site: { code: user.site.code, displayName: user.site.setting?.displayName ?? user.site.code },
    };
  }

  /** A real Argon2 hash of a value nobody knows, for constant-time failure. */
  private getDummyHash(): Promise<string> {
    this.dummyHash ??= AuthService.hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }
}
