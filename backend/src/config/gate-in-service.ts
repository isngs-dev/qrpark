import { BadRequestException } from '@nestjs/common';
import type { GateDirection } from '@prisma/client';

/**
 * Copied from eparking backend/src/config/gate-in-service.ts and adapted: a
 * payment is taken only at an entry gate that is in service. The two checks
 * stay separate because they send the operator to different fixes.
 */

export function assertGateInService(gate: { code: string; isActive: boolean } | null): void {
  if (!gate) throw new BadRequestException('Your account has no gate. Ask an administrator to assign one.');
  if (gate.isActive) return;
  throw new BadRequestException(
    `Gate "${gate.code}" is out of service. Ask an administrator to return it to service.`,
  );
}

export function assertGateAcceptsEntry(gate: { code: string; direction: GateDirection }): void {
  if (gate.direction === 'ENTRY') return;
  throw new BadRequestException(
    `Gate "${gate.code}" is an exit gate; payments are taken at entry gates.`,
  );
}
