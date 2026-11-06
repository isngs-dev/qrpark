import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Resolves the one site this deployment serves.
 *
 * A deployment serves exactly one site, identified by SITE_CODE. Every record
 * written carries the resulting siteId, so the schema is already multi-site
 * even though the runtime is not.
 *
 * SITE_CODE has no default: a deployment that forgot it must fail loudly, not
 * quietly write into some other site's rows.
 */
@Injectable()
export class SiteService {
  private cachedId?: string;

  constructor(private readonly prisma: PrismaService) {}

  get code(): string {
    const code = process.env.SITE_CODE;
    if (!code) throw new InternalServerErrorException('SITE_CODE is not set');
    return code;
  }

  async getId(): Promise<string> {
    if (this.cachedId) return this.cachedId;

    const site = await this.prisma.site.findUnique({
      where: { code: this.code },
      select: { id: true },
    });

    if (!site) {
      throw new InternalServerErrorException(
        `No site row for SITE_CODE="${this.code}". Run: npm run seed:site`,
      );
    }

    this.cachedId = site.id;
    return site.id;
  }
}
