import Link from 'next/link';

/**
 * Numbered pages under a long list. Adapted from eparking
 * admin/app/(portal)/pager.tsx (359c0c1): the backend pages by number, not by
 * cursor, so the links are previous / next with "Page N of M"; both ends are
 * still always drawn, a dead end greyed rather than removed.
 */
export function Pager({ links, noun }: { links: { label: string; prev: string | null; next: string | null }; noun: string }) {
  return (
    <nav aria-label={`${noun} pages`} className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
      <Step href={links.prev} label="← Previous" atEnd={`First page of ${noun}`} />
      <span className="text-xs text-ink-soft">{links.label}</span>
      <Step href={links.next} label="Next →" atEnd={`Last page of ${noun}`} />
    </nav>
  );
}

function Step({ href, label, atEnd }: { href: string | null; label: string; atEnd: string }) {
  const shape = 'rounded-md border px-3 py-1.5 text-sm font-medium';
  if (!href) {
    return (
      <span aria-disabled="true" title={atEnd} className={`${shape} cursor-not-allowed border-line-soft bg-muted-wash text-muted`}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={`${shape} border-line bg-surface text-ink hover:bg-line-soft`}>
      {label}
    </Link>
  );
}
