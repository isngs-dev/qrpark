'use client';

import { useEffect, useRef, useState } from 'react';
import { naira } from '@/lib/config-types';
import { dayLabel, rangeLabel, type Money, type Split } from '@/lib/reports-types';
import { barWidths, changeLabel, shareLabels, shares } from '@/lib/shares';
import { heightOf, niceScale, scaleLabel, thinTicks } from './charts.scale';

/**
 * Finance's analytics (UI-1). Written new. Inline SVG, drawn in the browser
 * from the backend's figures: no library, no external script, no CSP change.
 *
 * Every amount a reader is told is a backend figure as it came (naira() of a
 * field). The only numbers worked out here are display ones: bar heights and
 * axis marks (charts.scale.ts) and shares (lib/shares.ts). Colour is never the
 * only cue: cash is solid, card is hatched, every chart has its figures in
 * words (hover, focus or tap a column; and the tables on the page).
 */

/** One calm pair. Cash solid blue, card hatched teal: told apart without colour. */
export const SERIES = {
  cash: { label: 'Cash', fill: 'var(--series-parking)' },
  card: { label: 'Card', fill: 'url(#card-hatch)' },
} as const;

/** The hatch for card, defined once on the page. */
export function ChartDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="card-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--series-3)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2" />
        </pattern>
      </defs>
    </svg>
  );
}

export function Swatch({ series }: { series: keyof typeof SERIES }) {
  return (
    <svg width="12" height="12" className="inline-block flex-none align-[-1px]" aria-hidden="true" focusable="false">
      <rect width="12" height="12" rx="2" fill={SERIES[series].fill} />
    </svg>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap gap-4 text-xs text-ink-soft">
      <span className="inline-flex items-center gap-1.5"><Swatch series="cash" /> Cash (solid)</span>
      <span className="inline-flex items-center gap-1.5"><Swatch series="card" /> Card (hatched)</span>
    </p>
  );
}

/** One horizontal bar, [width] percent long. */
export function Bar({ width, fill = 'var(--series-parking)' }: { width: number; fill?: string }) {
  return (
    <svg width="100%" height="8" className="block" aria-hidden="true" focusable="false">
      <rect width="100%" height="8" rx="4" fill="var(--grid)" />
      {width > 0 ? <rect width={`${width}%`} height="8" rx="4" fill={fill} /> : null}
    </svg>
  );
}

/** A card on the page: the same frame, padding and title everywhere. */
export function Panel({ title, aside, children, className = '' }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>
        {aside ? <div className="text-xs text-ink-soft">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- KPIs

type Kpis = { averageKobo: number | null; bestDay: { day: string; total: Money } | null; busiestHour: { hour: number; count: number } | null };

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function Change({ current, previous }: { current: number; previous: number }) {
  const label = changeLabel(current, previous);
  const tone = label.startsWith('+') || label === 'new' ? 'text-good' : label.startsWith('−') ? 'text-bad' : 'text-ink-soft';
  // The sign and the word carry it, not the colour.
  return <span className={`font-semibold ${tone}`}>{label}</span>;
}

function Kpi({ label, value, sub, big = false, className = '' }: { label: string; value: string; sub?: React.ReactNode; big?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 rounded-card border border-line bg-surface px-4 py-3.5 ${className}`}>
      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-soft uppercase">{label}</p>
      <p className={`num mt-1 font-display leading-tight font-extrabold whitespace-nowrap text-ink ${big ? 'text-[26px] sm:text-[30px]' : 'text-[19px] sm:text-[21px]'}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-ink-soft">{sub}</p> : null}
    </div>
  );
}

/** UI-1: the headline numbers, each the backend's; the change against the period just before is a display percentage. */
export function KpiRow({ total, previous, kpis }: { total: Split; previous: { from: string; to: string; total: Split }; kpis: Kpis }) {
  return (
    <section aria-label="Key figures" className="mb-4">
      {/* Two rows: the headline pair large, then three supporting figures. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi big className="col-span-2 lg:col-span-3" label="Revenue" value={naira(total.total.kobo)} sub={<><Change current={total.total.kobo} previous={previous.total.total.kobo} /> vs previous period</>} />
        <Kpi big className="col-span-2 lg:col-span-3" label="Payments" value={String(total.total.count)} sub={<><Change current={total.total.count} previous={previous.total.total.count} /> vs previous period</>} />
        <Kpi className="lg:col-span-2" label="Average payment" value={kpis.averageKobo === null ? '–' : naira(kpis.averageKobo)} sub="Revenue ÷ payments" />
        <Kpi className="lg:col-span-2" label="Best day" value={kpis.bestDay ? naira(kpis.bestDay.total.kobo) : '–'} sub={kpis.bestDay ? dayLabel(kpis.bestDay.day) : 'No payment'} />
        <Kpi
          className="col-span-2 lg:col-span-2"
          label="Busiest hour"
          value={kpis.busiestHour ? `${hh(kpis.busiestHour.hour)}–${hh((kpis.busiestHour.hour + 1) % 24)}` : '–'}
          sub={kpis.busiestHour ? `${kpis.busiestHour.count} payments` : 'No payment'}
        />
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Change against {rangeLabel(previous)}, the same number of days just before (revenue {naira(previous.total.total.kobo)},{' '}
        {previous.total.total.count} payments).
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- cash and card

/** P1: Cash and Card side by side, each with its amount, count and share; one bar shows the split. */
export function CashCardTiles({ total }: { total: Split }) {
  const parts = [total.cash.kobo, total.card.kobo];
  const [cashShare, cardShare] = shareLabels(parts);
  const [cashTenths] = shares(parts);
  const tile = (key: 'cash' | 'card', m: Money, share: string) => (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-ink-soft uppercase">
        <Swatch series={key} /> {SERIES[key].label}
      </p>
      <p className="num mt-1 font-display text-[22px] leading-tight font-extrabold text-ink">{naira(m.kobo)}</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {m.count === 1 ? '1 payment' : `${m.count} payments`} · <span className="font-semibold text-ink">{share}</span>
      </p>
    </div>
  );
  return (
    <Panel title="Cash and card" aside="Share of revenue">
      {/* Side by side when there is room; stacked in the narrow side column at large widths. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {tile('cash', total.cash, cashShare)}
        {tile('card', total.card, cardShare)}
      </div>
      <svg width="100%" height="12" className="mt-4 block" role="img" aria-label={`Cash ${cashShare}, card ${cardShare}`} focusable="false">
        <rect width="100%" height="12" rx="3" fill={cashTenths === null ? 'var(--grid)' : SERIES.card.fill} />
        {cashTenths ? <rect width={`${cashTenths / 10}%`} height="12" rx="3" fill={SERIES.cash.fill} /> : null}
      </svg>
    </Panel>
  );
}

// ---------------------------------------------------------------- columns

export type Column = { key: string; tick: string; title: string } & Split;

/** The chart's own width, so text keeps its size at every screen width. */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Stacked cash and card columns on a nice scale, with gridlines, scale marks
 * and thinned x ticks. A quiet column is a short tick on the baseline. Hover,
 * focus (Tab) or tap a column for its figures, said in words below the chart.
 */
export function ColumnChart({ columns, label, empty, height = 220 }: { columns: Column[]; label: string; empty: string; height?: number }) {
  const [ref, W] = useWidth(720);
  const [active, setActive] = useState<number | null>(null);
  const left = 52;
  const right = 8;
  const top = 10;
  const bottom = 26;
  const pw = W - left - right;
  const ph = height - top - bottom;
  const n = columns.length;
  const scale = niceScale(Math.max(0, ...columns.map((c) => c.total.kobo)), 4, 10_000);
  const slot = n > 0 ? pw / n : pw;
  const bw = Math.max(2, Math.min(slot * 0.68, 44));
  const ticks = new Set(thinTicks(n, Math.max(2, Math.floor(pw / 64))));
  const quiet = columns.every((c) => c.total.count === 0);
  const a = active === null ? null : columns[active];

  return (
    <div>
      <div className="mb-2"><Legend /></div>
      <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="block max-w-full" role="group" aria-label={label}>
          {scale.marks.map((m) => {
            const y = top + ph - heightOf(m, scale.top, ph);
            return (
              <g key={m}>
                <line x1={left} x2={W - right} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />
                <text x={left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--ink-soft)">{scaleLabel(m)}</text>
              </g>
            );
          })}
          <line x1={left} x2={W - right} y1={top + ph + 0.5} y2={top + ph + 0.5} stroke="var(--line)" strokeWidth="1" />
          {columns.map((c, i) => {
            const cx = left + slot * i + slot / 2;
            const totalH = heightOf(c.total.kobo, scale.top, ph);
            const cashH = heightOf(c.cash.kobo, scale.top, ph);
            const cardH = Math.max(0, totalH - cashH);
            const base = top + ph;
            const on = active === i;
            return (
              <g key={c.key}>
                {on ? <rect x={left + slot * i} y={top} width={slot} height={ph} fill="var(--accent-wash)" /> : null}
                {c.total.count === 0 ? (
                  <rect x={cx - bw / 2} y={base - 2} width={bw} height={2} fill="var(--muted)" />
                ) : (
                  <>
                    {cardH > 0 ? <rect x={cx - bw / 2} y={base - totalH} width={bw} height={cardH} fill={SERIES.card.fill} /> : null}
                    {cashH > 0 ? <rect x={cx - bw / 2} y={base - cashH} width={bw} height={cashH} fill={SERIES.cash.fill} /> : null}
                  </>
                )}
                {ticks.has(i) ? (
                  // A label near either edge is anchored inward, so it is never cut off.
                  <text
                    x={cx + 28 > W ? W - right : cx - 28 < left ? left : cx}
                    y={height - 8}
                    textAnchor={cx + 28 > W ? 'end' : cx - 28 < left ? 'start' : 'middle'}
                    fontSize="11" fill="var(--ink-soft)"
                  >
                    {c.tick}
                  </text>
                ) : null}
                {/* The column's own hit area: hover, focus or tap shows its figures below. */}
                <rect
                  x={left + slot * i} y={top} width={slot} height={ph} fill="transparent" tabIndex={0}
                  role="button" aria-label={`${c.title}: ${naira(c.total.kobo)}, ${c.total.count} payments`}
                  className="cursor-pointer outline-none focus-visible:stroke-[var(--focus)] focus-visible:stroke-2"
                  onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {quiet ? (
          <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-ink-soft">{empty}</p>
        ) : null}
      </div>
      <p className="mt-2 min-h-[2.5em] text-xs text-ink-soft" aria-live="polite">
        {a ? (
          <>
            <span className="font-semibold text-ink">{a.title}</span>: <span className="num font-mono text-ink">{naira(a.total.kobo)}</span> ·{' '}
            Cash <span className="num font-mono">{naira(a.cash.kobo)}</span> ({a.cash.count}) · Card{' '}
            <span className="num font-mono">{naira(a.card.kobo)}</span> ({a.card.count}) · {a.total.count} payments
          </>
        ) : quiet ? null : (
          'Point at, tap or Tab to a column for its figures.'
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- vehicle types

/** Revenue by vehicle type: a bar against the largest, the share of revenue, the amount and the count. It is its own table. */
export function CategoryBars({ rows }: { rows: Array<{ category: { code: string; name: string } } & Split> }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-ink-soft">No payments in this range.</p>;
  const parts = rows.map((r) => r.total.kobo);
  const widths = barWidths(parts);
  const labels = shareLabels(parts);
  return (
    <table className="w-full border-collapse text-[13px]">
      <caption className="sr-only">Revenue by vehicle type, largest first</caption>
      <thead>
        <tr className="text-[11px] tracking-[0.06em] text-ink-soft uppercase">
          <th scope="col" className="pb-2 text-left font-semibold">Type</th>
          <th scope="col" className="w-[40%] pb-2 text-left font-semibold"><span className="sr-only">Bar</span></th>
          <th scope="col" className="pb-2 pl-2 text-right font-semibold">Share</th>
          <th scope="col" className="pb-2 pl-3 text-right font-semibold">Revenue</th>
          <th scope="col" className="hidden pb-2 pl-3 text-right font-semibold sm:table-cell">Payments</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.category.code} className="border-t border-line-soft">
            <td className="py-2 pr-3 whitespace-nowrap text-ink">{r.category.name}</td>
            <td className="py-2 pr-3"><Bar width={widths[i]} /></td>
            <td className="num py-2 pl-2 text-right font-mono text-xs text-ink-soft">{labels[i]}</td>
            <td className="num py-2 pl-3 text-right font-mono whitespace-nowrap text-ink">{naira(r.total.kobo)}</td>
            <td className="num hidden py-2 pl-3 text-right font-mono text-ink-soft sm:table-cell">{r.total.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

