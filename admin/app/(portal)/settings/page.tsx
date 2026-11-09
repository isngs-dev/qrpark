import { getSettings } from '@/lib/config';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'Configuration · QR Parking Admin' };

/** Adapted from eparking admin/app/(portal)/settings/page.tsx (359c0c1). */
export default async function SiteSettings() {
  const settings = await getSettings();
  if (!settings.ok) return <p className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad">{settings.message}</p>;
  return <SettingsForm settings={settings.data} />;
}
