import { redirect } from 'next/navigation';
import { signOut } from '@/lib/auth-actions';
import { readSession } from '@/lib/session';
import { mayUsePortal } from '@/lib/users-types';
import { Shell, type NavItem } from './shell';

/**
 * The signed-in shell. Adapted from eparking admin/app/(portal)/layout.tsx
 * (359c0c1): ADMIN only, qrpark's sections; the site name comes from the
 * sign-in answer, not an environment variable.
 *
 * Not the security boundary: the backend checks the token and the ADMIN role
 * on every route these screens call. Sign-out is a Server Action (POST).
 */
/** Every signed-in page is rendered per request from the backend; nothing is prerendered or cached. */
export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, refreshToken } = await readSession();
  if (!refreshToken) redirect('/login');
  if (user && !mayUsePortal(user.role)) redirect('/login');

  const nav: NavItem[] = [
    { href: '/', label: 'Overview', icon: 'overview', group: 'Operate' },
    { href: '/settings', label: 'Configuration', icon: 'settings', group: 'Configure' },
    { href: '/operators', label: 'Operators', icon: 'staff', group: 'Configure' },
  ];

  return (
    <Shell
      nav={nav}
      user={user ? { name: user.name, username: user.username, role: user.role } : null}
      siteName={user?.siteName ?? 'QR Parking'}
      signOut={
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </Shell>
  );
}
