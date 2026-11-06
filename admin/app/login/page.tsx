/**
 * Placeholder (Sprint 0). The form is not wired to anything: sign-in arrives
 * with the portal in Sprint 5.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">QR Parking Admin</h1>
        <label className="block text-sm">
          Email
          <input type="email" name="email" disabled className="mt-1 block w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          Password
          <input type="password" name="password" disabled className="mt-1 block w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <button type="button" disabled className="w-full rounded bg-slate-400 px-3 py-2 text-white">
          Sign in
        </button>
        <p className="text-xs text-slate-500">Placeholder. Sign-in is not available yet.</p>
      </form>
    </main>
  );
}
