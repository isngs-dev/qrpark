/**
 * Sprint 5b (review room): security headers on every response.
 *
 *   frame-ancestors 'none' / X-Frame-Options DENY  no other site may frame the portal (clickjacking)
 *   X-Content-Type-Options nosniff                 the browser never guesses a type
 *   Referrer-Policy no-referrer                    no portal URL leaks to another site
 *
 * The backend address is QRPARK_API_URL, read on the server only
 * (lib/backend-url.ts); nothing here exposes it to the browser.
 */
export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
