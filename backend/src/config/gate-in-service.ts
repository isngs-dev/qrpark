import { BadRequestException } from '@nestjs/common';
import type { GateDirection, PrismaClient } from '@prisma/client';

/**
 * Copied from eparking backend/src/config/gate-in-service.ts and adapted to
 * three kinds of location: each job works only at an in-service location of
 * its own kind (ENTRY gate, payment BOOTH, EXIT gate). The two checks stay
 * separate because they send the operator to different fixes.
 */

export function assertGateInService(gate: { code: string; isActive: boolean } | null): void {
  if (!gate) throw new BadRequestException('Your account has no location. Ask an administrator to assign one.');
  if (gate.isActive) return;
  throw new BadRequestException(
    `Location "${gate.code}" is out of service. Ask an administrator to return it to service.`,
  );
}

const KIND_NAME: Record<GateDirection, string> = { ENTRY: 'an entry gate', BOOTH: 'a payment booth', EXIT: 'an exit gate' };

/** The location is of the kind this job needs. */
export function assertGateKind(gate: { code: string; direction: GateDirection }, kind: GateDirection): void {
  if (gate.direction === kind) return;
  throw new BadRequestException(
    `Location "${gate.code}" is ${KIND_NAME[gate.direction]}; this is done at ${KIND_NAME[kind]}.`,
  );
}

/**
 * The operator's assigned location, read now: in service and of `kind`.
 * Refused: 400, before anything is written.
 */
export async function locationFor(
  prisma: Pick<PrismaClient, 'gate'>,
  actor: { gateId: string | null },
  siteId: string,
  kind: GateDirection,
) {
  const gate = actor.gateId ? await prisma.gate.findFirst({ where: { id: actor.gateId, siteId } }) : null;
  assertGateInService(gate);
  assertGateKind(gate!, kind);
  return gate!;
}
