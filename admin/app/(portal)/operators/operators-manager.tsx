'use client';

import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/config-actions';
import { LOCATION_LABELS, type Gate } from '@/lib/config-types';
import { createUser, deleteUser, setPassword, updateUser } from '@/lib/users-actions';
import { KIND_FOR_ROLE, MIN_PASSWORD_LENGTH, ROLES, ROLE_LABELS, lockoutWarning, type Role, type UserAccount } from '@/lib/users-types';
import { Card, Feedback, Field, SubmitButton } from '../settings/form-bits';

/**
 * Accounts. Adapted from eparking admin/app/(portal)/staff/staff-manager.tsx
 * (359c0c1): usernames; one job and one location of that job's kind; delete
 * (soft) with a confirm step.
 *
 * The lockout rules (yourself, the last active admin) are the backend's; the
 * controls here are disabled with the reason, as an explanation only.
 *
 * Passwords: typed by the admin into a password field, sent once by a Server
 * Action, never shown again (the form clears after it is sent), never put in a
 * URL. The backend never returns one.
 */
export function OperatorsManager({ accounts, gates, currentUserId }: { accounts: UserAccount[]; gates: Gate[]; currentUserId?: string }) {
  const [createState, create] = useActionState<ActionState, FormData>(createUser, {});
  const [editState, edit] = useActionState<ActionState, FormData>(updateUser, {});
  const [deleteState, remove] = useActionState<ActionState, FormData>(deleteUser, {});
  const [passwordState, password] = useActionState<ActionState, FormData>(setPassword, {});
  const [open, setOpen] = useState<{ id: string; panel: 'job' | 'password' | 'delete' } | null>(null);

  const activeAdmins = accounts.filter((a) => a.role === 'ADMIN' && a.isActive).length;
  const toggle = (id: string, panel: 'job' | 'password' | 'delete') =>
    setOpen(open?.id === id && open.panel === panel ? null : { id, panel });

  return (
    <>
      <Card title="Accounts" description={`${accounts.length} account(s), ${activeAdmins} active admin(s).`}>
        <div className="space-y-3">
          {accounts.map((account) => {
            const warning = lockoutWarning(account, currentUserId, activeAdmins);
            return (
              <div key={account.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">{account.name}</span>
                    {account.id === currentUserId ? <span className="ml-2 rounded bg-line-soft px-1.5 py-0.5 text-xs">you</span> : null}
                    <span className="block font-mono text-xs text-ink-soft">{account.username}</span>
                  </div>
                  <div className="text-right text-xs">
                    <span className="block">{ROLE_LABELS[account.role]}</span>
                    <span className="block text-ink-soft">{account.gate ? `${account.gate.name} (${account.gate.code})` : 'no location'}</span>
                    <span className={account.isActive ? 'text-good' : 'text-ink-soft'}>{account.isActive ? 'active' : 'deactivated'}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <form action={edit} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={account.id} />
                    <div>
                      <label className="block text-xs text-ink-soft" htmlFor={`name-${account.id}`}>Name</label>
                      <input key={account.name} id={`name-${account.id}`} name="name" defaultValue={account.name} className="mt-1 w-44 rounded border border-line px-2 py-1 text-sm" />
                    </div>
                    <SubmitButton variant="quiet" pendingLabel="…">Rename</SubmitButton>
                  </form>

                  <button type="button" onClick={() => toggle(account.id, 'job')} disabled={warning !== null && account.role === 'ADMIN'} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-60">
                    Job and location
                  </button>

                  <form action={edit}>
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="isActiveSubmitted" value="1" />
                    {account.isActive ? null : <input type="hidden" name="isActive" value="on" />}
                    <SubmitButton variant="quiet" pendingLabel="…" disabled={account.isActive && warning !== null}>
                      {account.isActive ? 'Deactivate' : 'Reactivate'}
                    </SubmitButton>
                  </form>

                  <button type="button" onClick={() => toggle(account.id, 'password')} className="rounded-md border border-line px-3 py-1.5 text-sm">
                    Set password
                  </button>

                  <button type="button" onClick={() => toggle(account.id, 'delete')} disabled={warning !== null} className="rounded-md border border-line px-3 py-1.5 text-sm text-bad disabled:opacity-60">
                    Delete…
                  </button>
                </div>

                {warning ? <p className="mt-2 text-xs text-accent">{warning}</p> : null}

                {open?.id === account.id && open.panel === 'job' ? (
                  <JobForm account={account} gates={gates} action={edit} />
                ) : null}

                {open?.id === account.id && open.panel === 'password' ? (
                  <form action={password} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={account.id} />
                    <div>
                      <label className="block text-xs text-ink-soft" htmlFor={`password-${account.id}`}>New password</label>
                      <input
                        id={`password-${account.id}`}
                        name="password"
                        type="password"
                        minLength={MIN_PASSWORD_LENGTH}
                        required
                        autoComplete="new-password"
                        className="mt-1 w-64 rounded border border-line px-2 py-1 text-sm"
                      />
                    </div>
                    <SubmitButton pendingLabel="Setting…">Set password</SubmitButton>
                    <span className="pb-1 text-xs text-ink-soft">At least {MIN_PASSWORD_LENGTH} characters. It is not shown again; tell the person directly.</span>
                  </form>
                ) : null}

                {open?.id === account.id && open.panel === 'delete' ? (
                  <form action={remove} className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-bad-wash px-3 py-2">
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="username" value={account.username} />
                    <span className="text-sm text-bad">
                      Delete {account.username}? They cannot sign in again and their sessions end now. Their tickets, payments and scans
                      stay in the reports.
                    </span>
                    <SubmitButton pendingLabel="Deleting…">Delete {account.username}</SubmitButton>
                    <button type="button" onClick={() => setOpen(null)} className="text-sm text-ink-soft underline">Keep</button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-4 space-y-2">
          <Feedback state={editState} />
          <Feedback state={passwordState} />
          <Feedback state={deleteState} />
        </div>
      </Card>

      <Card title="Add an account" description="The username is how they sign in: 3 to 32 of a–z, 0–9, dot, underscore and hyphen. One job and one location per account.">
        <form action={create} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username" name="username" required hint="e.g. booth-2" />
            <Field label="Name" name="name" required />
          </div>
          <JobFields gates={gates} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="new-password" className="block text-xs font-medium text-ink-soft">Password</label>
              <input
                id="new-password"
                name="password"
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                required
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-ink-soft">At least {MIN_PASSWORD_LENGTH} characters. It is not shown again; tell the person directly.</p>
            </div>
          </div>
          <Feedback state={createState} />
          <SubmitButton>Add account</SubmitButton>
        </form>
      </Card>
    </>
  );
}

/** Job and location for an existing account, changed together (the backend checks the pair). */
function JobForm({ account, gates, action }: { account: UserAccount; gates: Gate[]; action: (form: FormData) => void }) {
  return (
    <form action={action} className="mt-3 space-y-3 rounded-md border border-line-soft p-3">
      <input type="hidden" name="id" value={account.id} />
      <JobFields gates={gates} role={account.role} gateId={account.gate?.id} />
      <SubmitButton pendingLabel="Saving…">Save job and location</SubmitButton>
    </form>
  );
}

/** A job, and a location offered only from the in-service locations of that job's kind. */
function JobFields({ gates, role: initialRole, gateId }: { gates: Gate[]; role?: Role; gateId?: string }) {
  const [role, setRole] = useState<Role>(initialRole ?? 'ENTRY_OPERATOR');
  const kind = KIND_FOR_ROLE[role];
  const choices = kind ? gates.filter((g) => g.direction === kind && g.isActive) : [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="block text-xs font-medium text-ink-soft">
          Job
          <select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm">
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-soft">
          Location
          {kind ? (
            <select key={role} name="gateId" defaultValue={choices.some((g) => g.id === gateId) ? gateId : ''} required className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm">
              <option value="" disabled>{choices.length ? `Choose ${LOCATION_LABELS[kind].toLowerCase()}` : `No ${LOCATION_LABELS[kind].toLowerCase()} in service`}</option>
              {choices.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.code})</option>
              ))}
            </select>
          ) : (
            <input type="hidden" name="gateId" value="" />
          )}
        </label>
        {kind ? null : <p className="mt-2 text-xs text-ink-soft">An administrator has no location.</p>}
      </div>
    </div>
  );
}
