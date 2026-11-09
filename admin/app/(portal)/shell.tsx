'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  group: string;
}

const SIDEBAR_KEY = 'qrpark-sidebar';
const THEME_KEY = 'qrpark-theme';

/**
 * The signed-in shell: a slim header across the top, a sidebar under it.
 *
 * Adapted from eparking admin/app/(portal)/shell.tsx (359c0c1): qrpark storage
 * keys and wording; the account shows its username (no email).
 *
 * **The hamburger lives in the header, never in the sidebar.** A control that
 * opens a panel cannot live inside the panel it opens - collapse it once and
 * there is no way back.
 *
 * Two different behaviours share that one button, because "there is no room"
 * and "I want more room" are different problems:
 *
 *   wide screens   the sidebar collapses to nothing beside the content, and
 *                  the choice is remembered
 *   narrow screens it opens over the content as a drawer, with a scrim, and
 *                  closes on Escape or on navigating
 *
 * The mockup hid the sidebar outright below 760px, which left the hamburger
 * doing nothing at all on a phone - the one screen where it matters most.
 */
export function Shell({
  nav,
  user,
  siteName,
  signOut,
  children,
}: {
  nav: NavItem[];
  user: { name: string; username: string; role: string } | null;
  siteName: string;
  signOut: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Starts expanded and corrects itself on mount. The alternative is reading
  // localStorage during render, which the server cannot do and which would
  // make the markup disagree with itself on hydration.
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Read once on mount. Rendered expanded first because the server cannot know
  // the stored value, and markup that disagreed with itself would fail to
  // hydrate.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'collapsed');
    } catch {
      // A browser blocking site data. The sidebar simply starts open.
    }
    setRestored(true);
  }, []);

  // Write when it changes, in an effect rather than inside the setState
  // updater where it used to live. An updater is meant to be pure and React
  // may call it twice in development, so a write in there is a side effect
  // running an unpredictable number of times. Skipped until the stored value
  // has been read, or mounting would immediately write the default back over
  // whatever was saved.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open');
    } catch {
      // Not worth failing over; the sidebar just will not be remembered.
    }
  }, [collapsed, restored]);

  // Navigating closes the drawer. On a phone the destination is behind it.
  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function toggleNav() {
    // Which one the button means depends on how much room there is.
    if (window.matchMedia('(max-width: 860px)').matches) {
      setDrawerOpen((open) => !open);
      return;
    }
    setCollapsed((was) => !was);
  }

  const groups = nav.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3.5 border-b border-line bg-surface pr-4 pl-3">
        <button
          type="button"
          onClick={toggleNav}
          aria-label="Toggle navigation"
          aria-expanded={drawerOpen || !collapsed}
          aria-controls="portal-nav"
          className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink hover:bg-line-soft"
        >
          <Icon name="menu" className="h-[19px] w-[19px]" />
        </button>

        <Link href="/" className="flex items-center gap-2.5 rounded-md">
          {/* White plate in every theme: the logo's lettering is navy and
              disappears on a dark surface. */}
          <span className="flex-none rounded-[7px] bg-plate px-1.5 py-1">
            <Image src="/gsd-logo.png" alt="GSD Solutions" width={720} height={258} className="h-[22px] w-auto" />
          </span>
          <span className="hidden sm:block">
            <span className="block font-display text-[14.5px] leading-tight font-bold text-ink">
              {siteName}
            </span>
            <span className="block text-[11.5px] leading-tight text-ink-soft">QR Parking · Admin</span>
          </span>
        </Link>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
            <div className="flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1.5">
              <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-pending-wash font-display text-[10.5px] font-bold text-pending">
                {initials(user.name)}
              </span>
              <span className="hidden md:block">
                <span className="block text-[12.5px] leading-tight font-semibold text-ink">
                  {user.name}
                </span>
                <span className="block text-[10.5px] leading-tight text-ink-soft">{user.username}</span>
              </span>
            </div>
          ) : null}
          {signOut}
        </div>
      </header>

      <div className="portal-shell" data-collapsed={collapsed}>
        {/* Wide screens: a column in the grid. Narrow: a drawer over the
            content, which is why it carries both sets of classes. */}
        <aside
          id="portal-nav"
          className={[
            'overflow-hidden border-line bg-surface',
            'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:top-[var(--header-h)] max-md:z-20 max-md:w-[var(--sidebar-w)] max-md:border-r max-md:transition-transform',
            collapsed ? 'md:border-r-0' : 'md:border-r',
            drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
          ].join(' ')}
        >
          <nav className={collapsed ? 'px-0 py-3.5 md:invisible' : 'px-2.5 py-3.5'}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <p className="px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.08em] whitespace-nowrap text-ink-soft uppercase first:pt-0.5">
                  {group}
                </p>
                {items.map((item) => {
                  const current =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className={[
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] whitespace-nowrap',
                        current
                          ? 'bg-accent-wash font-semibold text-accent'
                          : 'font-medium text-ink-soft hover:bg-line-soft hover:text-ink',
                      ].join(' ')}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* The scrim. Clicking anywhere off the drawer closes it, which is what
            everybody tries before looking for the button again. */}
        {drawerOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 top-[var(--header-h)] z-10 bg-ink/30 md:hidden"
          />
        ) : null}

        <main className="min-w-0 px-5 pt-6 pb-16 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * Light, dark, or whatever the system says.
 *
 * The first press moves AWAY from what is currently on screen, which is what
 * somebody reaching for this button wants - they can see the theme they are
 * trying to leave. After that it is a straight flip.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') setTheme(saved);
    } catch {
      // No stored preference available; the system setting stands.
    }
  }, []);

  function toggle() {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const showing = theme ?? (systemDark ? 'dark' : 'light');
    const next = showing === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The theme still changes for this page; it just will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Toggle theme"
      aria-label="Toggle light or dark theme"
      className="grid h-[34px] w-[34px] place-items-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
    >
      {/* Both are rendered and CSS picks one, so the icon is right on the
          server too - swapping it in an effect would flash the wrong one. */}
      <Icon name="sun" className="theme-icon-light h-[17px] w-[17px]" />
      <Icon name="moon" className="theme-icon-dark h-[17px] w-[17px]" />
    </button>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
