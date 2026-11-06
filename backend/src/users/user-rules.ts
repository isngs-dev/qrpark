import { BadRequestException } from '@nestjs/common';
import { UserRole, type GateDirection } from '@prisma/client';

/**
 * Who may change what about a user account. Pure, so it is tested without a
 * database.
 *
 * Copied from eparking backend/src/staff/staff-rules.ts and adapted: a
 * username instead of an email, three roles, and a gate for every operator.
 *
 * Two rules stop a site locking itself out of its own portal:
 *
 *   1. An admin cannot deactivate or demote THEMSELVES.
 *   2. The LAST active admin cannot be deactivated or demoted, by anyone.
 *
 * Rule 1 alone is not enough (admin A demotes B, then nobody can fix A), and
 * rule 2 alone is not enough (an admin can still lock themselves out by
 * accident). Recovering from either would mean editing the database by hand.
 */

/** The shortest password worth calling one. Argon2 does the rest. */
export const MIN_PASSWORD_LENGTH = 12;

/** Lower-case letters, digits, dot, underscore, hyphen; 3-32 characters. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/**
 * Usernames are stored lower-case, so one person cannot become two accounts
 * by capitalisation. Same pattern as app_user_username_check.
 */
export function normaliseUsername(raw: string): string {
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestException(
      'A username must be 3-32 characters: lower-case letters, digits, dot, underscore or hyphen',
    );
  }
  return username;
}

export function assertPassword(password: string): void {
  // Length only. Composition rules push people towards Passw0rd! and a
  // shared sticky note; Argon2id and a real length do more.
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(`A password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

/** The gate direction an operator role works at; null for ADMIN. */
export function directionFor(role: UserRole): GateDirection | null {
  if (role === UserRole.ENTRY_OPERATOR) return 'ENTRY';
  if (role === UserRole.EXIT_OPERATOR) return 'EXIT';
  return null;
}

/**
 * An admin has no gate. An operator has exactly one, in service, facing the
 * operator's direction. The database enforces only "admin none, operator
 * one" (app_user_gate_by_role_check); direction and in-service are here.
 */
export function assertGateForRole(
  role: UserRole,
  gate: { direction: GateDirection; isActive: boolean; code: string } | null,
): void {
  const direction = directionFor(role);
  if (direction === null) {
    if (gate !== null) throw new BadRequestException('An administrator is not assigned to a gate');
    return;
  }
  if (gate === null) throw new BadRequestException(`An ${role} must be assigned to a gate`);
  if (!gate.isActive) throw new BadRequestException(`Gate "${gate.code}" is out of service`);
  if (gate.direction !== direction) {
    throw new BadRequestException(
      `Gate "${gate.code}" is an ${gate.direction} gate; an ${role} needs an ${direction} gate`,
    );
  }
}

export interface UserChange {
  role?: UserRole;
  isActive?: boolean;
}

/** Deactivating themselves, or moving themselves off ADMIN. */
export function isSelfDemotion(change: UserChange, current: { role: UserRole }): boolean {
  if (change.isActive === false) return true;
  if (change.role !== undefined && change.role !== current.role && current.role === UserRole.ADMIN) {
    return true;
  }
  return false;
}

export function assertNotSelfLockout(
  actorId: string,
  target: { id: string; role: UserRole },
  change: UserChange,
): void {
  if (actorId !== target.id) return;
  if (!isSelfDemotion(change, target)) return;
  throw new BadRequestException(
    'You cannot deactivate or change the role of your own account. Ask another administrator to do it.',
  );
}

/**
 * `otherActiveAdmins` counts active ADMINs other than the target. If the
 * target is the last active admin, a change that removes it is refused.
 */
export function assertNotLastAdmin(
  target: { role: UserRole; isActive: boolean },
  change: UserChange,
  otherActiveAdmins: number,
): void {
  const targetIsActiveAdmin = target.role === UserRole.ADMIN && target.isActive;
  if (!targetIsActiveAdmin) return;
  if (otherActiveAdmins > 0) return;

  const removesAdmin =
    change.isActive === false || (change.role !== undefined && change.role !== UserRole.ADMIN);
  if (!removesAdmin) return;

  throw new BadRequestException(
    'This is the last active administrator. Make another account ADMIN first, ' +
      'or the site would have nobody who can change its configuration.',
  );
}

export interface UserUpdate {
  name?: string;
  role?: UserRole;
  gateId?: string | null;
  isActive?: boolean;
}

/**
 * What a user edit may change. No username and no site: changing either
 * would move an account rather than edit it. No password: it has its own
 * route, so it is never set as a side effect.
 */
export function planUserUpdate(
  current: { name: string; role: UserRole; gateId: string | null; isActive: boolean },
  input: UserUpdate,
): UserUpdate {
  const update: UserUpdate = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A name cannot be blank');
    if (name !== current.name) update.name = name;
  }
  if (input.role !== undefined && input.role !== current.role) update.role = input.role;
  if (input.gateId !== undefined && input.gateId !== current.gateId) update.gateId = input.gateId;
  if (input.isActive !== undefined && input.isActive !== current.isActive) update.isActive = input.isActive;

  if (Object.keys(update).length === 0) throw new BadRequestException('Nothing to change');
  return update;
}

/**
 * Does this change end the user's current sessions? A role or gate change
 * (the app's mode and gate come from them), and a deactivation. A rename
 * does not.
 */
export function endsSessions(update: UserUpdate): boolean {
  return update.role !== undefined || update.gateId !== undefined || update.isActive === false;
}
