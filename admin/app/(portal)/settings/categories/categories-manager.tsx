'use client';

import { useActionState } from 'react';
import { changePrice, createCategory, updateCategory, type ActionState } from '@/lib/config-actions';
import { lagosTime, naira, type Category } from '@/lib/config-types';
import { Card, Feedback, Field, SubmitButton } from '../form-bits';

/**
 * Vehicle types and their flat prices.
 *
 * Adapted from eparking admin/app/(portal)/settings/categories/categories-manager.tsx
 * (359c0c1): each category carries one flat price (no pricing periods), set
 * here; the readOnly mode is gone (ADMIN only).
 *
 * A price change applies to tickets issued after it. Every ticket keeps the
 * fee it was issued with (the backend snapshots it), so nothing already issued
 * changes. The code is fixed once created: the app sends it.
 */
export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [createState, create] = useActionState<ActionState, FormData>(createCategory, {});
  const [editState, edit] = useActionState<ActionState, FormData>(updateCategory, {});
  const [priceState, price] = useActionState<ActionState, FormData>(changePrice, {});

  return (
    <>
      <Card
        title="Vehicle types"
        description="A new price applies to tickets issued after the change. Tickets already issued keep their own fee. Retired types stay on old tickets but are not offered at entry."
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-2 pb-2 whitespace-nowrap">Code</th>
                <th className="px-2 pb-2 whitespace-nowrap">Name</th>
                <th className="px-2 pb-2 text-right whitespace-nowrap">Price now</th>
                <th className="px-2 pb-2 whitespace-nowrap">New price (₦)</th>
                <th className="px-2 pb-2 whitespace-nowrap">Status</th>
                <th className="px-2 pb-2 whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-t border-line-soft align-middle">
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">
                    {category.code}
                    <span className="ml-2 text-muted" title="A vehicle type's code cannot be changed">fixed</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <form action={edit} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={category.id} />
                      <input key={category.name} name="name" aria-label={`Name of ${category.code}`} defaultValue={category.name} className="w-40 rounded border border-line px-2 py-1 text-sm" />
                      <SubmitButton variant="quiet" pendingLabel="…">Rename</SubmitButton>
                    </form>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono" title={`Last changed ${lagosTime(category.updatedAt)} (Lagos)`}>{naira(category.priceKobo)}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <form action={price} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={category.id} />
                      <input key={category.priceKobo} name="price" inputMode="decimal" aria-label={`New price for ${category.code}`} placeholder="e.g. 600" className="w-28 rounded border border-line px-2 py-1 text-sm" required />
                      <SubmitButton variant="quiet" pendingLabel="…">Set price</SubmitButton>
                    </form>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className={category.isActive ? 'text-good' : 'text-ink-soft'}>{category.isActive ? 'on sale' : 'retired'}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <form action={edit}>
                      <input type="hidden" name="id" value={category.id} />
                      <input type="hidden" name="isActiveSubmitted" value="1" />
                      {category.isActive ? null : <input type="hidden" name="isActive" value="on" />}
                      <SubmitButton variant="quiet" pendingLabel="…">{category.isActive ? 'Retire' : 'Bring back'}</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-2">
          <Feedback state={priceState} />
          <Feedback state={editState} />
        </div>
      </Card>

      <Card title="Add a vehicle type" description="The code is upper case, A–Z, 0–9 and underscore, starting with a letter. It cannot be changed later.">
        <form action={create} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Code" name="code" required hint="e.g. TRICYCLE" />
            <Field label="Name" name="name" required hint="e.g. Keke Napep" />
            <Field label="Price (₦)" name="price" required hint="e.g. 300 or 300.50" />
          </div>
          <Feedback state={createState} />
          <SubmitButton>Add vehicle type</SubmitButton>
        </form>
      </Card>
    </>
  );
}
