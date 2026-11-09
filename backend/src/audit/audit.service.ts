import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SiteService } from '../site.service';

/**
 * Who did what, when, to which record.
 *
 * Copied from eparking backend/src/audit/audit.service.ts; forTarget() is
 * left out until the portal reads the log (Sprint 5).
 *
 * Writes are append-only, and the database enforces it: the
 * audit_log_append_only trigger raises on UPDATE and DELETE.
 *
 * `detail` is before and after values. Never a password, a hash or a token.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
  ) {}

  async record(params: {
    /** Null only for LOGIN_THROTTLED (nobody is signed in); the database refuses it for any other action. */
    actorId: string | null;
    action: AuditAction;
    targetType: string;
    targetId: string;
    detail?: Prisma.InputJsonValue;
    /**
     * The transaction the audited change is written in. Passing it makes the
     * row commit or roll back WITH the change it describes.
     */
    client?: Prisma.TransactionClient;
  }) {
    const siteId = await this.site.getId();

    const row = await (params.client ?? this.prisma).auditLog.create({
      data: {
        siteId,
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        detail: params.detail,
      },
    });

    // The action and the ids only; the detail is not logged.
    this.logger.log(`${params.action} on ${params.targetType}:${params.targetId} by ${params.actorId ?? '(nobody signed in)'}`);
    return row;
  }
}

/** { field: { from, to } } for each field whose value changed. */
export function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> {
  const out: Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      out[field] = {
        from: (before[field] ?? null) as Prisma.InputJsonValue | null,
        to: (after[field] ?? null) as Prisma.InputJsonValue | null,
      };
    }
  }
  return out;
}
