/**
 * Sprint 5b (review room): security headers on every response.
 *
 *   frame-ancestors 'none' / X-Frame-Options DENY  no other site may frame the portal (clickjacking)
 *   X-Content-Type-Options nosniff                 the browser never guesses a type
 *   Referrer-Policy no-referrer                    no portal URL leaks to another site
 *
 * The backend address is QRPARK_API_URL, read on the server only
 * (lib/backend-url.mjs); nothing here exposes it to the browser.
 */
import { PHASE_PRODUCTION_SERVER } from 'next/constants.js';
import { requireProductionBackendUrl } from './lib/backend-url.mjs';

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

/**
 * Hardening H3 (T12): "next start" (the production server) refuses to start
 * unless QRPARK_API_URL is set and https; the error names the variable and
 * the process exits. A production build needs no backend address; dev keeps
 * the localhost default.
 *
 * @param {string} phase  Next's phase (next/constants)
 */
export default function config(phase) {
  if (phase === PHASE_PRODUCTION_SERVER) requireProductionBackendUrl();
  return nextConfig;
}
