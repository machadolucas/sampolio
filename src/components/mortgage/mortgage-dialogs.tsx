'use client';

import { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { SelectButton } from 'primereact/selectbutton';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { MonthPicker, HelpTip } from '@/components/ui/form-primitives';
import { formatCurrency, formatRate } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import { recomputeAnnuityPayment } from '@/lib/mortgage-projection';
import {
  setMortgageRate,
  recordMortgageBalanceSnapshot,
  addMortgageExtraPayment,
  addMortgageMemberByEmail,
  removeMortgageMember,
} from '@/lib/actions/shared-mortgages';
import type { SharedMortgage, Currency } from '@/types';

interface PreviewLoan {
  label: string;
  balance: number;
  remainingMonths: number;
  margin: number;
}

// ── Euribor update (the key yearly action) ──────────────────────────────────
export function EuriborUpdateDialog({
  visible,
  mortgageId,
  defaultEffectiveMonth,
  lastEuribor,
  previewLoans,
  currency,
  onClose,
  onSaved,
}: {
  visible: boolean;
  mortgageId: string;
  defaultEffectiveMonth: string;
  lastEuribor: number;
  previewLoans: PreviewLoan[];
  currency: Currency;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [euribor, setEuribor] = useState<number>(lastEuribor);
  const [effectiveDate, setEffectiveDate] = useState(defaultEffectiveMonth);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const oldTotal = previewLoans.reduce((s, l) => s + recomputeAnnuityPayment(l.balance, lastEuribor + l.margin, l.remainingMonths), 0);
  const newTotal = previewLoans.reduce((s, l) => s + recomputeAnnuityPayment(l.balance, euribor + l.margin, l.remainingMonths), 0);
  const delta = newTotal - oldTotal;

  const save = async () => {
    setSaving(true);
    setError('');
    const res = await setMortgageRate(mortgageId, { effectiveDate, euriborRate: euribor });
    setSaving(false);
    if (res.success) onSaved('Euribor updated — your payments are recalculated.');
    else setError(res.error ?? 'Failed to save');
  };

  return (
    <Dialog header="Update your Euribor rate" visible={visible} onHide={onClose} style={{ width: '32rem' }}>
      <p className="text-sm opacity-70 mb-3">
        Banks reset the 12-month Euribor once a year. Enter the new rate and your payments update automatically.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">New 12-month Euribor rate</label>
          <InputNumber value={euribor} onValueChange={(e) => setEuribor(e.value ?? 0)} suffix=" %" minFractionDigits={2} maxFractionDigits={3} className="w-full" />
          <HelpTip text="Euribor is the rate European banks charge each other. Your loan rate = Euribor + the bank's fixed margin." />
        </div>
        <div>
          <label className="text-sm font-medium">Effective from</label>
          <MonthPicker value={effectiveDate} onChange={setEffectiveDate} />
        </div>

        <div className="p-3 rounded-lg surface-ground text-sm">
          <div className="flex items-center justify-between">
            <span className="opacity-70">Loan payment (principal + interest)</span>
            <span>
              {formatCurrency(oldTotal, currency)} → <span className="font-semibold">{formatCurrency(newTotal, currency)}</span>
            </span>
          </div>
          <div className="mt-2">
            <Tag
              value={`${delta >= 0 ? '+' : ''}${formatCurrency(delta, currency)} / month`}
              severity={delta > 0 ? 'danger' : delta < 0 ? 'success' : 'info'}
            />
            <span className="ml-2 opacity-60">
              {delta > 0 ? 'goes up' : delta < 0 ? 'goes down' : 'no change'} at the new rate ({formatRate(euribor + (previewLoans[0]?.margin ?? 0))})
            </span>
          </div>
        </div>

        {error && <Message severity="error" text={error} />}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button label="Cancel" text onClick={onClose} />
        <Button label="Update rate" loading={saving} onClick={save} />
      </div>
    </Dialog>
  );
}

// ── Drift adjustment ────────────────────────────────────────────────────────
export function DriftAdjustmentDialog({
  visible,
  mortgageId,
  loans,
  expectedByLoan,
  currency,
  onClose,
  onSaved,
}: {
  visible: boolean;
  mortgageId: string;
  loans: { id: string; label: string }[];
  expectedByLoan: Record<string, number>;
  currency: Currency;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [loanId, setLoanId] = useState(loans[0]?.id ?? '');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [actualBalance, setActualBalance] = useState<number>(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const expected = expectedByLoan[loanId] ?? 0;
  const variance = actualBalance - expected;

  const save = async () => {
    setSaving(true);
    setError('');
    const res = await recordMortgageBalanceSnapshot(mortgageId, { loanId, yearMonth, actualBalance });
    setSaving(false);
    if (res.success) onSaved('Balance corrected — projections re-anchored to your real number.');
    else setError(res.error ?? 'Failed to save');
  };

  return (
    <Dialog header="Correct a balance" visible={visible} onHide={onClose} style={{ width: '30rem' }}>
      <p className="text-sm opacity-70 mb-3">
        If your bank statement differs from our estimate, enter the real balance here. We&apos;ll re-anchor future projections to it.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Loan</label>
          <Dropdown value={loanId} options={loans.map((l) => ({ label: l.label, value: l.id }))} onChange={(e) => setLoanId(e.value)} className="w-full" />
        </div>
        <div>
          <label className="text-sm font-medium">Month of the statement</label>
          <MonthPicker value={yearMonth} onChange={setYearMonth} />
        </div>
        <div>
          <label className="text-sm font-medium">Actual balance from your bank statement</label>
          <InputNumber value={actualBalance} onValueChange={(e) => setActualBalance(e.value ?? 0)} mode="currency" currency={currency} locale="fi-FI" className="w-full" />
        </div>
        <div className="p-3 rounded-lg surface-ground text-sm">
          We projected {formatCurrency(expected, currency)}. You entered {formatCurrency(actualBalance, currency)}.
          <div className="mt-1">
            <Tag value={`Difference: ${variance >= 0 ? '+' : ''}${formatCurrency(variance, currency)}`} severity={Math.abs(variance) < 1 ? 'info' : variance > 0 ? 'danger' : 'success'} />
          </div>
        </div>
        {error && <Message severity="error" text={error} />}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button label="Cancel" text onClick={onClose} />
        <Button label="Save correction" loading={saving} onClick={save} disabled={!loanId} />
      </div>
    </Dialog>
  );
}

// ── Extra / early payment ────────────────────────────────────────────────────
export function ExtraPaymentDialog({
  visible,
  mortgageId,
  loans,
  currency,
  onClose,
  onSaved,
}: {
  visible: boolean;
  mortgageId: string;
  loans: { id: string; label: string }[];
  currency: Currency;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [loanId, setLoanId] = useState(loans[0]?.id ?? '');
  const [date, setDate] = useState(getCurrentYearMonth());
  const [amount, setAmount] = useState<number>(0);
  const [mode, setMode] = useState<'shorten-term' | 'lower-payment'>('shorten-term');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!amount || amount <= 0) { setError('Enter an amount'); return; }
    setSaving(true);
    setError('');
    const res = await addMortgageExtraPayment(mortgageId, { loanId, date, amount, mode });
    setSaving(false);
    if (res.success) onSaved('Extra payment added.');
    else setError(res.error ?? 'Failed to save');
  };

  return (
    <Dialog header="Make an extra payment" visible={visible} onHide={onClose} style={{ width: '30rem' }}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Loan</label>
          <Dropdown value={loanId} options={loans.map((l) => ({ label: l.label, value: l.id }))} onChange={(e) => setLoanId(e.value)} className="w-full" />
        </div>
        <div>
          <label className="text-sm font-medium">Month</label>
          <MonthPicker value={date} onChange={setDate} />
        </div>
        <div>
          <label className="text-sm font-medium">Amount</label>
          <InputNumber value={amount} onValueChange={(e) => setAmount(e.value ?? 0)} mode="currency" currency={currency} locale="fi-FI" className="w-full" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">What should it do?</label>
          <SelectButton
            value={mode}
            onChange={(e) => e.value && setMode(e.value)}
            options={[
              { label: 'Pay it off sooner', value: 'shorten-term' },
              { label: 'Lower my monthly payment', value: 'lower-payment' },
            ]}
          />
          <HelpTip
            text={
              mode === 'shorten-term'
                ? 'Your monthly payment stays the same, but you finish paying earlier.'
                : 'You keep paying until the same end date, but each month costs less.'
            }
          />
        </div>
        {error && <Message severity="error" text={error} />}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button label="Cancel" text onClick={onClose} />
        <Button label="Add payment" loading={saving} onClick={save} disabled={!loanId} />
      </div>
    </Dialog>
  );
}

// ── Members management ───────────────────────────────────────────────────────
export function MortgageMembersDialog({
  visible,
  mortgage,
  currentUserId,
  onClose,
  onChanged,
}: {
  visible: boolean;
  mortgage: SharedMortgage;
  currentUserId?: string;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [initialPayment, setInitialPayment] = useState<number>(0);
  const [sharePercent, setSharePercent] = useState<number>(50);
  const [targetPercent, setTargetPercent] = useState<number>(50);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isOwner = mortgage.members.find((m) => m.userId === currentUserId)?.role === 'owner';

  const add = async () => {
    setSaving(true);
    setError('');
    const res = await addMortgageMemberByEmail(mortgage.id, { email, initialPayment, loanSharePercent: sharePercent / 100, ownershipTargetPercent: targetPercent / 100 });
    setSaving(false);
    if (res.success) {
      setEmail('');
      onChanged('Member added.');
    } else setError(res.error ?? 'Failed to add member');
  };

  const remove = async (userId: string) => {
    const res = await removeMortgageMember(mortgage.id, userId);
    if (res.success) onChanged('Member removed.');
    else setError(res.error ?? 'Failed to remove member');
  };

  return (
    <Dialog header="Who can see this mortgage" visible={visible} onHide={onClose} style={{ width: '32rem' }}>
      <p className="text-sm opacity-70 mb-3">Both members can see and edit everything here — there&apos;s no privacy between you.</p>
      <div className="space-y-2 mb-4">
        {mortgage.members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between p-2 rounded surface-ground text-sm">
            <div>
              <span className="font-medium">{m.name}</span>
              <span className="opacity-50 ml-2">{m.email}</span>
              {m.role === 'owner' && <Tag value="owner" severity="info" className="ml-2 text-xs" />}
              {m.userId === currentUserId && <Tag value="you" severity="success" className="ml-1 text-xs" />}
            </div>
            {isOwner && m.userId !== currentUserId && (
              <Button icon="pi pi-trash" text severity="danger" size="small" onClick={() => remove(m.userId)} />
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <div className="border-t surface-border pt-3 space-y-2">
          <label className="text-sm font-medium">Invite by email</label>
          <InputText value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" className="w-full" />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs opacity-70">Down payment</label>
              <InputNumber value={initialPayment} onValueChange={(e) => setInitialPayment(e.value ?? 0)} mode="currency" currency={mortgage.currency} locale="fi-FI" className="w-full" />
            </div>
            <div>
              <label className="text-xs opacity-70">Loan share %</label>
              <InputNumber value={sharePercent} onValueChange={(e) => setSharePercent(e.value ?? 0)} suffix=" %" className="w-full" />
            </div>
            <div>
              <label className="text-xs opacity-70">Target own %</label>
              <InputNumber value={targetPercent} onValueChange={(e) => setTargetPercent(e.value ?? 0)} suffix=" %" className="w-full" />
            </div>
          </div>
          {error && <Message severity="error" text={error} />}
          <Button label="Add member" loading={saving} onClick={add} disabled={!email} className="w-full mt-1" />
        </div>
      )}
    </Dialog>
  );
}
