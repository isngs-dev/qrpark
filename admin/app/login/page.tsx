import Image from 'next/image';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · QR Parking Admin' };

/**
 * Adapted from eparking admin/app/login/page.tsx (359c0c1): QR Parking wording;
 * the site name is not an environment variable (it arrives with the sign-in
 * answer and shows in the header).
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-6">
        {/* White plate in every theme: the logo's lettering is navy. */}
        <span className="inline-block rounded-[10px] bg-plate px-3 py-2">
          <Image src="/gsd-logo.png" alt="GSD Solutions" width={720} height={258} priority className="h-10 w-auto" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">QR Parking</h1>
        <p className="text-sm text-ink-soft">Admin portal · administrators only</p>
      </div>

      <div className="rounded-card border border-line bg-surface p-6">
        <LoginForm />
      </div>

      <p className="mt-4 text-xs text-ink-soft">Operators sign in on the parking app, not here.</p>
    </main>
  );
}
