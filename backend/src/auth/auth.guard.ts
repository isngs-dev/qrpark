import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';
import type { TokenClaims } from './auth.service';

/**
 * Copied from eparking backend/src/auth/auth.guard.ts and adapted: the user
 * is re-read on every request, so logout, deactivation and role or gate
 * changes take effect at once, and the role checked is the DATABASE role,
 * never the one written in the token.
 */

/** Marks an endpoint as reachable without a token. Used sparingly. */
export const PUBLIC = 'auth:public';
export const Public = () => SetMetadata(PUBLIC, true);

/** Roles allowed to call an endpoint. Every non-public route declares them. */
export const ROLES = 'auth:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export interface Actor {
  id: string;
  siteId: string;
  role: UserRole;
  gateId: string | null;
}

/**
 * Applied globally, so an endpoint is protected unless it opts out with
 * @Public(). Role checks happen here, in the backend, on every request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (claims.typ !== 'access') throw new UnauthorizedException('Refresh tokens cannot call the API');

    const user = await this.prisma.appUser.findUnique({
      where: { id: claims.sub },
      select: { id: true, siteId: true, role: true, gateId: true, isActive: true, tokenVersion: true },
    });
    if (
      !user ||
      !user.isActive ||
      user.tokenVersion !== claims.ver ||
      user.siteId !== (await this.site.getId())
    ) {
      throw new UnauthorizedException('Session has ended; sign in again');
    }

    request.actor = { id: user.id, siteId: user.siteId, role: user.role, gateId: user.gateId };

    // A route with no @Roles() is refused rather than open to any signed-in
    // user: forgetting the decorator must fail closed.
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ROLES, targets) ?? [];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException('Your role cannot do this');
    }
    return true;
  }
}

/** The authenticated caller, from the verified token and the database. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
  if (!request.actor) throw new UnauthorizedException('No authenticated actor on this request');
  return request.actor;
});
