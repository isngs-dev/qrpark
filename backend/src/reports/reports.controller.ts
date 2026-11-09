import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/auth.guard';
import { ReportsService, type Range } from './reports.service';

/**
 * The admin reports, read-only, ADMIN only (docs/api.md "Admin: reports").
 * Every list route answers JSON, or a CSV with ?format=csv (from and to
 * required, at most 31 days, at most 50,000 rows). Unknown query fields are
 * refused (400) by the global validation pipe.
 */

class RangeQuery {
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional() @IsIn(['json', 'csv'], { message: 'format must be json or csv' }) format?: 'json' | 'csv';
}

class PagedQuery extends RangeQuery {
  @IsOptional() @IsString() @MaxLength(6) page?: string;
  @IsOptional() @IsString() @MaxLength(6) pageSize?: string;
}

class TransactionsQuery extends PagedQuery {
  @IsOptional() @IsString() @MaxLength(12) q?: string;
  @IsOptional() @IsString() @MaxLength(12) state?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(40) entryGate?: string;
  @IsOptional() @IsString() @MaxLength(40) booth?: string;
  @IsOptional() @IsString() @MaxLength(40) operator?: string;
  @IsOptional() @IsString() @MaxLength(8) method?: string;
}

class AuditQuery extends PagedQuery {
  @IsOptional() @IsString() @MaxLength(40) action?: string;
  @IsOptional() @IsString() @MaxLength(40) actor?: string;
}

class DayQuery {
  @IsOptional() @IsString() @MaxLength(10) day?: string;
}

function sendCsv(res: Response, name: string, r: Range, body: string): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="qrpark-${name}-${r.from}-to-${r.to}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  return body;
}

@Controller('admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles('ADMIN')
  @Get('reports/dashboard')
  async dashboard(@Query() q: DayQuery) {
    const r = await this.reports.range({ from: q.day, to: q.day }, false);
    return this.reports.dashboard(r.from);
  }

  @Roles('ADMIN')
  @Get('reports/transactions')
  async transactions(@Query() q: TransactionsQuery, @Res({ passthrough: true }) res: Response) {
    const csv = q.format === 'csv';
    const r = await this.reports.range(q, csv);
    const filters = { q: q.q, state: q.state, category: q.category, entryGate: q.entryGate, booth: q.booth, operator: q.operator, method: q.method };
    if (csv) return sendCsv(res, 'transactions', r, await this.reports.transactionsCsv(r, filters));
    return this.reports.transactions(r, filters, this.reports.paging(q));
  }

  @Roles('ADMIN')
  @Get('reports/transactions/:id')
  transaction(@Param('id') id: string) {
    return this.reports.transaction(id);
  }

  @Roles('ADMIN')
  @Get('reports/incomplete')
  async incomplete(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) {
    const csv = q.format === 'csv';
    const r = await this.reports.range(q, csv);
    if (csv) return sendCsv(res, 'incomplete', r, await this.reports.incompleteCsv(r));
    return this.reports.incomplete(r);
  }

  @Roles('ADMIN')
  @Get('reports/finance')
  async finance(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) {
    const csv = q.format === 'csv';
    const r = await this.reports.range(q, csv);
    if (csv) return sendCsv(res, 'finance', r, await this.reports.financeCsv(r));
    return this.reports.finance(r);
  }

  @Roles('ADMIN')
  @Get('audit')
  async audit(@Query() q: AuditQuery, @Res({ passthrough: true }) res: Response) {
    const csv = q.format === 'csv';
    const r = await this.reports.range(q, csv);
    if (csv) return sendCsv(res, 'audit', r, await this.reports.auditCsv(r, q));
    return this.reports.audit(r, q, this.reports.paging(q));
  }
}
