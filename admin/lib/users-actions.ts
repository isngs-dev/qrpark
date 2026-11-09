'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';
import type { ActionState } from './config-actions';
import type { Gate } from './config-types';
import { operatorProblem, passwordProblem, type UserAccount } from './users-types';

/**
 * Account writes: Server Actions (POST), ADMIN at the backend.
 *
 * Adapted from eparking admin/lib/staff-actions.ts (359c0c1): usernames; one
 * job and one location per account; delete (soft) added.
 *
 * Passwords (Sprint 5b rule): typed by the admin, sent once in the request
 * body to the backend, and never echoed, logged, stored here or put in a URL.
 * No message below mentions the password itself.
 *
 * The lockout rules (yourself, the last active admin) are the backend's; the
 * refusal is passed through as the backend words it.
 */

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

async function gatesFor(role: string, gateId: string): Promise<string | null> {
  const gates = await api<Gate[]>('/admin/gates');
  if (!gates.ok) return gates.message;
  return operatorProblem({ role, gateId }, gates.data);
}

export async function createUser(_p: ActionState, form: FormData): Promise<ActionState> {
  const role = text(form, 'role');
  const gateId = text(form, 'gateId');
  const password = String(form.get('password') ?? '');
  const problem = passwordProblem(password) ?? (await gatesFor(role, gateId));
  if (problem) return { error: problem };

  const result = await api<UserAccount>('/admin/users', {
    method: 'POST',
    body: { username: text(form, 'username'), name: text(form, 'name'), role, gateId: role === 'ADMIN' ? null : gateId, password },
  });
  if (!result.ok) return { error: result.message };
  revalidatePath('/operators');
  return { saved: `${result.data.username} added. Give them the password you typed; it is not shown again.` };
}

/** Rename; change job and location together; deactivate or reactivate. */
export async function updateUser(_p: ActionState, form: FormData): Promise<ActionState> {
  const body: { name?: string; role?: string; gateId?: string | null; isActive?: boolean } = {};
  if (form.has('name')) body.name = text(form, 'name');
  if (form.has('role')) {
    const role = text(form, 'role');
    const gateId = text(form, 'gateId');
    const problem = await gatesFor(role, gateId);
    if (problem) return { error: problem };
    body.role = role;
    body.gateId = role === 'ADMIN' ? null : gateId;
  }
  if (form.has('isActiveSubmitted')) body.isActive = form.get('isActive') === 'on';

  const result = await api<UserAccount>(`/admin/users/${text(form, 'id')}`, { method: 'PATCH', body });
  if (!result.ok) return { error: result.message };
  revalidatePath('/operators');
  return { saved: `${result.data.username} updated.` };
}

/** A soft delete: hidden, cannot sign in, sessions end at once, history kept, username reusable. */
export async function deleteUser(_p: ActionState, form: FormData): Promise<ActionState> {
  const username = text(form, 'username');
  const result = await api(`/admin/users/${text(form, 'id')}`, { method: 'DELETE' });
  if (!result.ok) return { error: result.message };
  revalidatePath('/operators');
  return { saved: `${username} deleted. Their tickets, payments and scans stay in the reports.` };
}

/** A new password set by the admin. Ends the account's sessions. */
export async function setPassword(_p: ActionState, form: FormData): Promise<ActionState> {
  const password = String(form.get('password') ?? '');
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const result = await api(`/admin/users/${text(form, 'id')}/password`, { method: 'POST', body: { password } });
  if (!result.ok) return { error: result.message };
  revalidatePath('/operators');
  return { saved: 'Password set. Their sessions have ended; they sign in again with the new password.' };
}
