'use client';

import { useActionState } from 'react';
import { createGate, updateGate, type ActionState } from '@/lib/config-actions';
import { LOCATION_KINDS, LOCATION_LABELS, type Gate } from '@/lib/config-types';
import { Card, Feedback, Field, Select, SubmitButton } from '../form-bits';

/**
 * Entry gates, payment booths and exit gates.
 *
 * Adapted from eparking admin/app/(portal)/settings/gates/gates-manager.tsx
 * (359c0c1): three kinds (ENTRY, BOOTH, EXIT); no devices (no device registry
 * in qrpark: devices are controlled through accounts).
 *
 * Code and kind are fixed once created; tickets, payments and scans name the
 * location. Take one out of service instead. Each operator works at one
 * in-service location of their job's kind.
 */
export function LocationsManager({ gates }: { gates: Gate[] }) {
  const [createState, create] = useActionState<ActionState, FormData>(createGate, {});
  const [editState, edit] = useActionState<ActionState, FormData>(updateGate, {});

  return (
    <>
      {LOCATION_KINDS.map((kind) => {
        const ofKind = gates.filter((g) => g.direction === kind);
        return (
          <Card key={kind} title={`${LOCATION_LABELS[kind]}s`}>
            {ofKind.length === 0 ? (
              <p className="text-sm text-ink-soft">None yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="text-left text-xs uppercase text-ink-soft">
                    <tr>
                      <th className="px-2 pb-2 whitespace-nowrap">Code</th>
                      <th className="px-2 pb-2 whitespace-nowrap">Name</th>
                      <th className="px-2 pb-2 whitespace-nowrap">Status</th>
                      <th className="px-2 pb-2 whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {ofKind.map((gate) => (
                      <tr key={gate.id} className="border-t border-line-soft">
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{gate.code}</td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <form action={edit} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={gate.id} />
                            <input key={gate.name} name="name" aria-label={`Name of ${gate.code}`} defaultValue={gate.name} className="w-44 rounded border border-line px-2 py-1 text-sm" />
                            <SubmitButton variant="quiet" pendingLabel="…">Rename</SubmitButton>
                          </form>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <span className={gate.isActive ? 'text-good' : 'text-ink-soft'}>{gate.isActive ? 'in service' : 'out of service'}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          <form action={edit}>
                            <input type="hidden" name="id" value={gate.id} />
                            <input type="hidden" name="isActiveSubmitted" value="1" />
                            {gate.isActive ? null : <input type="hidden" name="isActive" value="on" />}
                            <SubmitButton variant="quiet" pendingLabel="…">{gate.isActive ? 'Take out of service' : 'Return to service'}</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      <Feedback state={editState} />

      <Card title="Add a location" description="The code is upper case, A–Z, 0–9 and underscore, starting with a letter. Code and kind cannot be changed later.">
        <form action={create} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Code" name="code" required hint="e.g. BOOTH_3" />
            <Field label="Name" name="name" required hint="e.g. Booth 3 (north car park)" />
            <Select label="Kind" name="direction" defaultValue="BOOTH" options={LOCATION_KINDS.map((k) => ({ value: k, label: LOCATION_LABELS[k] }))} />
          </div>
          <Feedback state={createState} />
          <SubmitButton>Add location</SubmitButton>
        </form>
      </Card>
    </>
  );
}
