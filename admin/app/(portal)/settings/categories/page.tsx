import { getCategories } from '@/lib/config';
import { CategoriesManager } from './categories-manager';

export const metadata = { title: 'Vehicle types and prices · QR Parking Admin' };

/** Adapted from eparking admin/app/(portal)/settings/categories/page.tsx (359c0c1). */
export default async function CategoriesPage() {
  const categories = await getCategories();
  if (!categories.ok) return <p className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad">{categories.message}</p>;
  return <CategoriesManager categories={categories.data} />;
}
