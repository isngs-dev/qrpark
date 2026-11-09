'use client';

import { useActionState } from 'react';
import { updateSettings, type ActionState } from '@/lib/config-actions';
import { lagosTime, type Settings } from '@/lib/config-types';
import { Card, Feedback, Field, SubmitButton } from './form-bits';

/**
 * Site name, the two ticket lines, the payment window; Paystack mode read-only.
 * Adapted from eparking admin/app/(portal)/settings/site-config-form.tsx
 * (359c0c1): qrpark's settings only (no buffer, debounce, passes or overrides).
 */
export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState<ActionState, FormData>(updateSettings, {});
  // Remount on new stored values: defaultValue applies only on mount.
  const signature = JSON.stringify(settings);

  return (
    <form key={signature} action={action} className="space-y-6">
      <Card title="Site" description="The market's name, shown in the apps and on the ticket when no organisation name is set.">
        <Field label="Site name" name="displayName" defaultValue={settings.displayName} hint="1 to 100 characters." required />
      </Card>

      <Card
        title="Printed on the ticket"
        description="The brand line between the GSD and AIC logos, and the contact line beneath it. Empty uses the site name and prints no contact line."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name" name="receiptOrgName" defaultValue={settings.receiptOrgName ?? ''} hint="Up to 120 characters." />
          <Field label="Contact line" name="receiptContactLine" defaultValue={settings.receiptContactLine ?? ''} hint="Up to 120 characters." />
        </div>
      </Card>

      <Card title="Card payments" description="How long a card payment that has not finished blocks the booth operator from starting another.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment window (minutes)" name="paymentWindowMinutes" type="number" defaultValue={settings.paymentWindowMinutes} hint="1 to 30." required />
          <Field
            label="Paystack mode"
            name="paystackModeDisplay"
            defaultValue={settings.paystackMode}
            disabled
            hint="Read-only: set by the backend's environment. Test keys only until go-live is approved."
          />
        </div>
      </Card>

      <p className="text-xs text-ink-soft">Last changed {lagosTime(settings.updatedAt)} (Lagos time). Every change is in the audit log.</p>
      <Feedback state={state} />
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}
