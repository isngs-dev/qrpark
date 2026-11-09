import { api } from './api';
import { REPORTS, reportQuery, type AuditRow, type Dashboard, type FinanceReport, type IncompleteReport, type Paged, type TxDetail, type TxRow } from './reports-types';

/**
 * Reading the reports (Sprint 5c). Server-only (the session cookies). Written
 * new. Every figure is the backend's; the portal passes only each report's own
 * parameters and never a day of its own.
 */

type Input = Record<string, string | string[] | undefined>;

const withQuery = (path: string, query: string) => (query ? `${path}?${query}` : path);

export const getDashboard = (input: Input) => api<Dashboard>(withQuery(REPORTS.dashboard.path, reportQuery('dashboard', input)));

export const getTransactions = (input: Input, page: number) =>
  api<Paged<TxRow>>(withQuery(REPORTS.transactions.path, reportQuery('transactions', input, { page })));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ticket's story. A malformed id never reaches the backend; the page shows not found. */
export const getTransaction = async (id: string) =>
  UUID.test(id) ? api<TxDetail>(`${REPORTS.transactions.path}/${id}`) : ({ ok: false, status: 404, message: 'No ticket found' } as const);

export const getIncomplete = (input: Input) => api<IncompleteReport>(withQuery(REPORTS.incomplete.path, reportQuery('incomplete', input)));

export const getFinance = (input: Input) => api<FinanceReport>(withQuery(REPORTS.finance.path, reportQuery('finance', input)));

export const getAudit = (input: Input, page: number) => api<Paged<AuditRow>>(withQuery(REPORTS.audit.path, reportQuery('audit', input, { page })));

/** The page number from the address: a whole number from 1, else 1. */
export function pageFrom(input: Input): number {
  const raw = Array.isArray(input.page) ? input.page[0] : input.page;
  return raw && /^\d{1,5}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}
