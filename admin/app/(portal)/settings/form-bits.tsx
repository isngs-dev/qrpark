'use client';

import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/config-actions';

/** Shared pieces, so every settings form reports itself the same way. */

export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'quiet';
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const base = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60';
  const style =
    variant === 'primary'
      ? 'bg-ink text-paper'
      : 'border border-line text-ink';

  return (
    <button type="submit" disabled={pending || disabled} className={`${base} ${style}`}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </button>
  );
}

export function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md bg-bad-wash px-3 py-2 text-sm text-bad whitespace-pre-line">
        {state.error}
      </p>
    );
  }
  if (state.saved) {
    return <p className="rounded-md bg-good-wash px-3 py-2 text-sm text-good">{state.saved}</p>;
  }
  return null;
}

export function Field({
  label,
  name,
  defaultValue,
  hint,
  type = 'text',
  required,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  hint?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-ink-soft">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm disabled:bg-line-soft disabled:text-ink-soft"
      />
      {hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-ink-soft">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <div className="mt-1 text-xs text-ink-soft">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
