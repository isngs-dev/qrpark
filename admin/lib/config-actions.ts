'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';
import { koboFromNaira, naira } from './config-types';

/**
 * The configuration writes: Server Actions (POST), never a GET.
 *
 * Adapted from eparking admin/lib/config-actions.ts (359c0c1): qrpark's admin
 * routes and fields; a category's flat price; three location kinds; no
 * pricing rules, pass plans or devices.
 *
 * Every one is ADMIN at the backend, which is the answer that counts. Nothing
 * here computes a price: the one conversion is naira to kobo of a figure the
 * admin typed.
 */

export interface ActionState {
  error?: string;
  saved?: string;
}

async function write(path: string, method: 'POST' | 'PATCH', body: unknown, revalidate: string, saved: string): Promise<ActionState> {
  const result = await api(path, { method, body });
  if (!result.ok) return { error: result.message };
  revalidatePath(revalidate);
  return { saved };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

// ------------------------------------------------------------- categories and prices

export async function createCategory(_p: ActionState, form: FormData): Promise<ActionState> {
  const priceKobo = koboFromNaira(text(form, 'price'));
  if (priceKobo === null) return { error: 'Enter the price in naira, for example 500 or 500.50.' };
  return write(
    '/admin/categories',
    'POST',
    { code: text(form, 'code'), name: text(form, 'name'), priceKobo },
    '/settings/categories',
    `Vehicle type ${text(form, 'code').toUpperCase()} added at ${naira(priceKobo)}.`,
  );
}

/** Rename, or retire / bring back. No code is sent: a category's code never changes. */
export async function updateCategory(_p: ActionState, form: FormData): Promise<ActionState> {
  const body: { name?: string; isActive?: boolean } = {};
  if (form.has('name')) body.name = text(form, 'name');
  if (form.has('isActiveSubmitted')) body.isActive = form.get('isActive') === 'on';
  return write(`/admin/categories/${text(form, 'id')}`, 'PATCH', body, '/settings/categories', 'Vehicle type updated.');
}

/**
 * A new flat price. It applies to tickets issued after it: every ticket carries
 * its own fee snapshot, so nothing already issued changes.
 */
export async function changePrice(_p: ActionState, form: FormData): Promise<ActionState> {
  const priceKobo = koboFromNaira(text(form, 'price'));
  if (priceKobo === null) return { error: 'Enter the price in naira, for example 500 or 500.50.' };
  return write(
    `/admin/categories/${text(form, 'id')}`,
    'PATCH',
    { priceKobo },
    '/settings/categories',
    `Price set to ${naira(priceKobo)} for new tickets. Tickets already issued keep their own fee.`,
  );
}

// ------------------------------------------------------------- settings

export async function updateSettings(_p: ActionState, form: FormData): Promise<ActionState> {
  const window = text(form, 'paymentWindowMinutes');
  if (!/^\d{1,2}$/.test(window)) return { error: 'The payment window is a whole number of minutes, 1 to 30.' };
  return write(
    '/admin/settings',
    'PATCH',
    {
      displayName: text(form, 'displayName'),
      paymentWindowMinutes: Number(window),
      // Empty clears the line on the ticket (the backend accepts "").
      receiptOrgName: text(form, 'receiptOrgName'),
      receiptContactLine: text(form, 'receiptContactLine'),
    },
    '/settings',
    'Settings saved.',
  );
}

// ------------------------------------------------------------- locations

export async function createGate(_p: ActionState, form: FormData): Promise<ActionState> {
  return write(
    '/admin/gates',
    'POST',
    { code: text(form, 'code'), name: text(form, 'name'), direction: text(form, 'direction') },
    '/settings/locations',
    `Location ${text(form, 'code').toUpperCase()} added.`,
  );
}

/** Rename, or take out of / return to service. Code and kind never change. */
export async function updateGate(_p: ActionState, form: FormData): Promise<ActionState> {
  const body: { name?: string; isActive?: boolean } = {};
  if (form.has('name')) body.name = text(form, 'name');
  if (form.has('isActiveSubmitted')) body.isActive = form.get('isActive') === 'on';
  return write(`/admin/gates/${text(form, 'id')}`, 'PATCH', body, '/settings/locations', 'Location updated.');
}
