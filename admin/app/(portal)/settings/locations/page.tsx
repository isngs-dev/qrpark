import { getGates } from '@/lib/config';
import { LocationsManager } from './locations-manager';

export const metadata = { title: 'Locations · QR Parking Admin' };

/** Adapted from eparking admin/app/(portal)/settings/gates/page.tsx (359c0c1): no devices. */
export default async function LocationsPage() {
  const gates = await getGates();
  if (!gates.ok) return <p className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad">{gates.message}</p>;
  return <LocationsManager gates={gates.data} />;
}
