import type { NextRequest } from 'next/server';
import { backendUrl } from '@/lib/backend-url';
import { csvResponse } from '@/lib/csv-route';
import { readSession } from '@/lib/session';
import { mayUsePortal } from '@/lib/users-types';

/**
 * The CSV download (Sprint 5c): the portal's only route handler. Written new.
 * READ-ONLY and GET only: the browser never talks to the backend, so the file
 * comes through here; the guards are in lib/csv-route.ts (tested there).
 * The middleware has already refreshed the session cookies.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ report: string }> }) {
  const { report } = await context.params;
  const { accessToken, user } = await readSession();
  const admin = accessToken && mayUsePortal(user?.role) ? accessToken : undefined;
  return csvResponse(report, request.nextUrl.searchParams, admin, fetch, backendUrl());
}
