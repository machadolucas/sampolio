'use client';

import { useState, useMemo, useId } from 'react';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { HelpTip } from '@/components/ui/form-primitives';
import { formatYearMonth, getCurrencySymbol } from '@/lib/constants';
import { confirmBudget } from '@/lib/actions/budgets';
import type { Budget, FinancialAccount } from '@/types';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';

export function BudgetConfirmDialog({
  visible,
  budget,
  accounts,
  onHide,
  onConfirmed,
}: {
  visible: boolean;
  budget: Budget;
  accounts: FinancialAccount[];
  onHide: () => void;
  onConfirmed: (b: Budget) => void;
}) {
  const uid = useId();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Re-seed on open, derive-during-render (no cascading-render effect).
  if (visible && !seeded) {
    setSeeded(true);
    setAccountId(budget.linkedAccountId ?? accounts[0]?.id ?? null);
    setRate(budget.exchangeRate ?? null);
    setError('');
  }
  if (!visible && seeded) setSeeded(false);

  const account = useMemo(() => accounts.find(a => a.id === accountId) ?? null, [accounts, accountId]);
  const needsRate = !!account && account.currency !== budget.currency;

  const submit = async () => {
    setError('');
    if (!accountId) {
      setError('Pick the account the trip money moves through');
      return;
    }
    setSaving(true);
    const res = await confirmBudget(budget.id, {
      linkedAccountId: accountId,
      exchangeRate: needsRate ? rate ?? undefined : undefined,
    });
    setSaving(false);
    if (res.success && res.data) {
      onConfirmed(res.data);
      onHide();
    } else {
      setError(res.error ?? 'Something went wrong');
    }
  };

  const onFormSubmit = useFormSubmit(submit, { disabled: saving });

  return (
    <Dialog header="Add to my cashflow" visible={visible} onHide={onHide} style={{ width: '28rem' }}>
      <form className="space-y-3" onSubmit={onFormSubmit} noValidate>
        <p className="text-sm opacity-80">
          This adds the budget&apos;s costs and incoming money to your cashflow for{' '}
          <b>{formatYearMonth(budget.startMonth)} – {formatYearMonth(budget.endMonth)}</b>, so your balance forecast
          includes the trip. Nothing is copied — if you change the budget, your cashflow updates too. You can undo
          this anytime.
        </p>
        <div>
          <label htmlFor={`${uid}-which-account`} className="text-sm font-medium">Which account?</label>
          <Dropdown inputId={`${uid}-which-account`}
            value={accountId}
            options={accounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))}
            onChange={(e) => setAccountId(e.value)}
            placeholder="Pick an account"
            className="w-full"
          />
        </div>
        {needsRate && account && (
          <div>
            <label htmlFor={`${uid}-exchange-rate-1`} className="text-sm font-medium">
              Exchange rate: 1 {getCurrencySymbol(budget.currency)} ({budget.currency}) = ? {getCurrencySymbol(account.currency)} ({account.currency})
            </label>
            <InputNumber inputId={`${uid}-exchange-rate-1`}
              value={rate}
              onValueChange={(e) => setRate(e.value ?? null)}
              minFractionDigits={2}
              maxFractionDigits={6}
              locale="fi-FI"
              className="w-full"
            />
            <HelpTip text={`Used to show ${budget.currency} amounts in ${account.currency} in your cashflow. A rough rate is fine.`} />
          </div>
        )}
        {error && <Message severity="error" text={error} className="w-full" />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" label="Cancel" text severity="secondary" onClick={onHide} disabled={saving} />
          <Button label="Add to my cashflow" loading={saving} type="submit" />
        </div>
      </form>
    </Dialog>
  );
}
