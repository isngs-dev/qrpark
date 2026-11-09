import Link from 'next/link';
import { getCategories, getGates, getSettings } from '@/lib/config';
import { LOCATION_KINDS, LOCATION_LABELS, naira } from '@/lib/config-types';
import { getUsers } from '@/lib/users';
import { ROLE_LABELS, ROLES } from '@/lib/users-types';
import { Block, Note, PageHead, TableWrap, Td, Th, Tr } from './ui';

export const metadata = { title: 'Overview · QR Parking Admin' };

/**
 * What is configured, at a glance (Sprint 5b). Counts of what the backend
 * returned; every price is the backend's, shown from kobo. The reports
 * (dashboard, transactions, finance) come in Sprint 5c.
 */
export default async function Overview() {
  const [settings, categories, gates, users] = await Promise.all([getSettings(), getCategories(), getGates(), getUsers()]);
  const failed = [settings, categories, gates, users].find((r) => !r.ok);
  if (failed && !failed.ok) return <p className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad">{failed.message}</p>;
  if (!settings.ok || !categories.ok || !gates.ok || !users.ok) return null;

  return (
    <>
      <PageHead title={settings.data.displayName} when={`Paystack: ${settings.data.paystackMode}`} />

      <Block title="Vehicle types and prices" aside={<Link className="text-accent" href="/settings/categories">Change</Link>}>
        <TableWrap>
          <thead>
            <tr><Th>Vehicle type</Th><Th>Code</Th><Th align="right">Price for a new ticket</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {categories.data.map((c) => (
              <Tr key={c.id}>
                <Td>{c.name}</Td>
                <Td variant="mono">{c.code}</Td>
                <Td variant="amount">{naira(c.priceKobo)}</Td>
                <Td>{c.isActive ? 'on sale' : 'retired'}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Block>

      <Block title="Locations in service" aside={<Link className="text-accent" href="/settings/locations">Change</Link>}>
        <TableWrap>
          <tbody>
            {LOCATION_KINDS.map((kind) => (
              <Tr key={kind}>
                <Td>{LOCATION_LABELS[kind]}s</Td>
                <Td variant="mono">{gates.data.filter((g) => g.direction === kind && g.isActive).map((g) => g.code).join(', ') || '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Block>

      <Block title="Active accounts" aside={<Link className="text-accent" href="/operators">Change</Link>}>
        <TableWrap>
          <tbody>
            {ROLES.map((role) => (
              <Tr key={role}>
                <Td>{ROLE_LABELS[role]}</Td>
                <Td variant="amount">{users.data.filter((u) => u.role === role && u.isActive).length}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Block>

      <Note>Reports (dashboard, transactions, incomplete sessions, finance, audit) arrive in the next part of this sprint.</Note>
    </>
  );
}
