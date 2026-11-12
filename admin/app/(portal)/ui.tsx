import { Icon } from './icons';

/**
 * The pieces every screen is built from.
 *
 * They live here so a pill on the audit log is the same pill as on a pass, and
 * a table on Finance is the same table as on Passes. Restyling per page is how
 * six screens end up looking like six products.
 */

/**
 * A status.
 *
 * Three tones only, and the vocabulary is deliberately narrow:
 *
 *   good     it worked, it is live, the money arrived
 *   bad      it failed, it was refused, it was switched off
 *   pending  nobody knows yet - in flight, not started, awaiting Paystack
 *
 * **These are never chart colours and chart colours are never these.** Parking
 * blue and pass orange identify a data series; they say nothing about whether
 * anything is healthy. Borrowing one for the other makes a legend read as a
 * verdict.
 */
export function Pill({
  tone,
  children,
}: {
  tone: 'good' | 'bad' | 'pending';
  children: React.ReactNode;
}) {
  const tones = {
    good: 'bg-good-wash text-good',
    bad: 'bg-bad-wash text-bad',
    pending: 'bg-pending-wash text-pending',
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full py-[3px] pr-2.5 pl-[7px] text-[11.5px] font-semibold whitespace-nowrap ${tones[tone]}`}
    >
      {/* The dot carries the colour, so the tone survives being read aloud as
          well as looked at - the text beside it still says what happened. */}
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A figure with its period, and optionally what it is made of. */
export function Tile({
  period,
  total,
  breakdown,
}: {
  period: string;
  total: string;
  breakdown?: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-[18px] py-4">
      <p className="text-[11.5px] font-semibold tracking-[0.06em] text-ink-soft uppercase">
        {period}
      </p>
      <p className="num mt-1.5 font-display text-[25px] leading-tight font-extrabold text-ink">
        {total}
      </p>
      {breakdown && breakdown.length > 0 ? (
        <div className="mt-3 flex gap-4 border-t border-line-soft pt-3">
          {breakdown.map((part) => (
            <div key={part.label}>
              <p className="text-xs text-ink-soft">{part.label}</p>
              <p className="num font-mono text-xs font-medium text-ink">{part.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      {children}
    </div>
  );
}

/** A titled section, with an optional count or note on the right. */
export function Block({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      {title ? (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>
          {aside ? <span className="text-xs text-ink-soft">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A table that scrolls sideways rather than squashing.
 *
 * Plates, references and money must not wrap - a plate broken across two lines
 * stops being one plate - so the wrapper scrolls and the page itself never
 * does.
 */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full border-collapse bg-surface">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align,
}: {
  children?: React.ReactNode;
  align?: 'right';
}) {
  return (
    <th
      scope="col"
      className={`border-b border-line bg-line-soft px-3.5 py-2.5 text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-ink-soft uppercase ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  variant,
}: {
  children?: React.ReactNode;
  /** `mono` for anything compared character by character; `amount` right-aligns it. */
  variant?: 'mono' | 'amount';
}) {
  const styles = {
    mono: 'font-mono text-[12.5px] text-ink-soft',
    amount: 'num font-mono text-right text-ink',
  } as const;

  return (
    <td
      className={`border-b border-line-soft px-3.5 py-[11px] text-[13px] whitespace-nowrap text-ink last:border-b-0 ${
        variant ? styles[variant] : ''
      }`}
    >
      {children}
    </td>
  );
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="hover:bg-line-soft">{children}</tr>;
}

/** The audit-style row: when it happened on the left, what happened on the right. */
export function ActivityList({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-line">{children}</div>
  );
}

export function ActivityRow({
  when,
  children,
}: {
  when: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5 border-b border-line-soft bg-surface px-3.5 py-3 last:border-b-0">
      <div className="w-[120px] flex-none font-mono text-[11.5px] text-ink-soft">{when}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ActivityMeta({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-xs text-ink-soft">{children}</p>;
}

/** A standing caveat about what a screen does and does not show. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-start gap-2 rounded-[9px] bg-accent-wash px-4 py-3 text-[12.5px] text-accent">
      <Icon name="info" className="mt-px h-[15px] w-[15px] flex-none" />
      <p>{children}</p>
    </div>
  );
}

/** Nothing to show, said plainly rather than left as blank space. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-ink-soft">
      {children}
    </div>
  );
}

/** The page's own heading, with the context line the mockup puts beside it. */
export function PageHead({ title, when }: { title: string; when?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="font-display text-[21px] font-bold text-ink">{title}</h1>
      {when ? <p className="text-[12.5px] text-ink-soft">{when}</p> : null}
    </div>
  );
}
