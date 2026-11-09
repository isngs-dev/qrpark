import type { Metadata } from 'next';
import './globals.css';

/**
 * Adapted from eparking admin/app/layout.tsx (359c0c1): no Google fonts (system
 * faces, nothing fetched from a third party); qrpark's theme key and title.
 */

export const metadata: Metadata = {
  title: 'QR Parking Admin',
  description: 'Vehicle types and prices, settings, locations and operators.',
};

/**
 * Apply the saved theme before the first paint (inline and synchronous, or the
 * page flashes in the system theme). Only the theme choice is stored.
 */
const APPLY_THEME = `
try {
  var t = localStorage.getItem('qrpark-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
