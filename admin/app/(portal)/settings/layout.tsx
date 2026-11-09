import Link from 'next/link';

/**
 * The configuration section. Adapted from eparking
 * admin/app/(portal)/settings/layout.tsx (359c0c1): qrpark's three tabs; the
 * FINANCE read-only banner is gone (only ADMIN signs in here).
 *
 * Operational settings live in the database and change here, without a
 * redeploy.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const tabs = [
    { href: '/settings', label: 'Site and ticket' },
    { href: '/settings/categories', label: 'Vehicle types and prices' },
    { href: '/settings/locations', label: 'Locations' },
  ];

  return (
    <>
      <h1 className="text-xl font-semibold">Configuration</h1>
      <p className="mt-1 text-sm text-ink-soft">Prices, ticket text, payment window and locations. Changes take effect without a redeploy.</p>

      <nav className="mt-5 flex flex-wrap gap-2 border-b border-line pb-3 text-sm">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-surface-sunk">
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 space-y-6">{children}</div>
    </>
  );
}
