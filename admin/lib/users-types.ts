/**
 * Accounts: the shapes, and rules that touch no server (pure).
 *
 * Adapted from eparking admin/lib/staff-types.ts (359c0c1): usernames, not
 * emails; the four qrpark roles, each with one location of its kind; the
 * dashboard shapes are gone (5c). A password appears in no shape here because
 * it appears in no response.
 *
 * Every rule below is the BACKEND's. The portal repeats them only to explain a
 * disabled control or catch a slip before sending; the backend refuses anyway.
 */

import type { Gate, LocationKind } from './config-types';

export type Role = 'ADMIN' | 'ENTRY_OPERATOR' | 'PAYMENT_OPERATOR' | 'EXIT_OPERATOR';

export const ROLES: Role[] = ['ENTRY_OPERATOR', 'PAYMENT_OPERATOR', 'EXIT_OPERATOR', 'ADMIN'];

export const ROLE_LABELS: Record<Role, string> = {
  ENTRY_OPERATOR: 'Entry operator',
  PAYMENT_OPERATOR: 'Payment booth operator',
  EXIT_OPERATOR: 'Exit operator',
  ADMIN: 'Administrator',
};

/** The location kind each operator job works at; an admin has none. */
export const KIND_FOR_ROLE: Record<Role, LocationKind | null> = {
  ENTRY_OPERATOR: 'ENTRY',
  PAYMENT_OPERATOR: 'BOOTH',
  EXIT_OPERATOR: 'EXIT',
  ADMIN: null,
};

const KIND_WORDS: Record<LocationKind, string> = { ENTRY: 'an entry gate', BOOTH: 'a payment booth', EXIT: 'an exit gate' };

/** As the backend enforces: length only. */
export const MIN_PASSWORD_LENGTH = 12;

export interface UserAccount {
  id: string;
  username: string;
  name: string;
  role: Role;
  isActive: boolean;
  gate: { id: string; code: string; name: string; direction: LocationKind } | null;
  createdAt: string;
  updatedAt: string;
}

/** Only an ADMIN account has anything to do in this portal (the backend refuses everyone else anyway). */
export function mayUsePortal(role: string | undefined): boolean {
  return role === 'ADMIN';
}

export function passwordProblem(password: string): string | null {
  return password.length >= MIN_PASSWORD_LENGTH ? null : `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
}

/** One job, one in-service location of that job's kind; an admin has none. */
export function operatorProblem(input: { role: string; gateId: string }, gates: Array<Pick<Gate, 'id' | 'direction' | 'isActive'>>): string | null {
  if (!(ROLES as string[]).includes(input.role)) return 'Choose a job.';
  const kind = KIND_FOR_ROLE[input.role as Role];
  if (kind === null) return input.gateId ? 'An administrator has no location.' : null;
  if (!input.gateId) return `Choose ${KIND_WORDS[kind]}.`;
  const gate = gates.find((g) => g.id === input.gateId);
  if (!gate || gate.direction !== kind) return `This job works at ${KIND_WORDS[kind]}.`;
  if (!gate.isActive) return 'That location is out of service. Choose one in service.';
  return null;
}

/**
 * Why this account may not be deactivated or deleted here, if so: yourself,
 * or the last active admin. Shown beside a disabled button; the backend is
 * what refuses.
 */
export function lockoutWarning(account: UserAccount, actorId: string | undefined, activeAdmins: number): string | null {
  if (account.id === actorId) return 'This is your own account: you cannot deactivate, delete or demote yourself.';
  if (account.role === 'ADMIN' && account.isActive && activeAdmins <= 1) {
    return 'This is the last active admin. Make another account an active admin first.';
  }
  return null;
}
