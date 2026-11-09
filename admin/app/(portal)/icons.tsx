/**
 * The console's icons.
 *
 * Inline SVG rather than an icon package: there are nine of them, they are
 * already drawn, and a dependency to render nine paths would need justifying.
 * Each one inherits `currentColor`, so an icon is whatever colour its text is
 * and needs no per-theme handling.
 *
 * They are decoration beside a label that already says the same thing, so they
 * are hidden from assistive technology rather than repeating it.
 */

type IconName =
  | 'overview'
  | 'passes'
  | 'audit'
  | 'finance'
  | 'settings'
  | 'staff'
  | 'menu'
  | 'sun'
  | 'moon'
  | 'info'
  | 'close';

const PATHS: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <path d="M3 12 12 4l9 8" />
      <path d="M5 10v9h14v-9" />
      <path d="M10 19v-6h4v6" />
    </>
  ),
  passes: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="8.5" cy="12" r="2" />
      <path d="M13 10h5M13 14h3" />
    </>
  ),
  audit: (
    <>
      <path d="M9 3h9v18H6a2 2 0 0 1-2-2V7z" />
      <path d="M9 3v4H5" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  finance: <path d="M4 19V6l5 3 3-4 3 4 5-3v13z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="17.5" cy="8.5" r="2.4" />
      <path d="M16 14.3c2.9.4 4.9 2.4 4.9 5.7" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  sun: (
    <>
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
      <circle cx="12" cy="12" r="4.2" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-[18px] w-[18px]'}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
