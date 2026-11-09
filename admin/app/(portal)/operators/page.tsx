import { getGates } from '@/lib/config';
import { readSession } from '@/lib/session';
import { getUsers } from '@/lib/users';
import { OperatorsManager } from './operators-manager';

export const metadata = { title: 'Operators · QR Parking Admin' };

/**
 * Accounts: one job and one location each. Adapted from eparking
 * admin/app/(portal)/staff/page.tsx (359c0c1). Deleted accounts are not listed
 * (the backend leaves them out); they stay in the reports as "name (deleted)".
 */
export default async function OperatorsPage() {
  const [users, gates, { user }] = await Promise.all([getUsers(), getGates(), readSession()]);
  if (!users.ok || !gates.ok) {
    const message = !users.ok ? users.message : !gates.ok ? gates.message : '';
    return <p className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad">{message}</p>;
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Operators</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Who can sign in, their one job, and where they work. A change of job or location, a deactivation, a deletion or a new
        password ends that person&apos;s sessions at once.
      </p>
      <div className="mt-6 space-y-6">
        <OperatorsManager accounts={users.data} gates={gates.data} currentUserId={user?.id} />
      </div>
    </>
  );
}
