'use client';

import { useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { MultiSelect } from 'primereact/multiselect';
import { SelectButton } from 'primereact/selectbutton';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { MonthPicker, HelpTip } from '@/components/ui/form-primitives';
import { BUDGET_CATEGORIES, CURRENCIES, formatCurrency } from '@/lib/constants';
import { getMonthsBetween } from '@/lib/projection';
import { calcPerDiemTotal, getBudgetPeriodDays } from '@/lib/budget-utils';
import { budgetDetailsSchema, budgetLineSchema, budgetFundingSchema } from '@/lib/schemas/budget.schema';
import {
  addBudgetLine,
  updateBudgetLine,
  addBudgetFundingSource,
  updateBudgetFundingSource,
  updateBudget,
} from '@/lib/actions/budgets';
import type { Budget, BudgetLine, BudgetFundingSource, BudgetFundingType, BudgetFundingTiming, Currency } from '@/types';

const KIND_OPTIONS = [
  { label: 'Every month', value: 'monthly' },
  { label: 'Just once', value: 'one-off' },
];

const TIMING_OPTIONS = [
  { label: 'At the start of the trip', value: 'upfront' },
  { label: 'A bit every month', value: 'monthly' },
  { label: 'In a specific month', value: 'specific-month' },
];

const FUNDING_TYPE_OPTIONS = [
  { label: 'Grant or stipend', value: 'grant' },
  { label: 'Daily allowance', value: 'per-diem' },
  { label: 'Something else', value: 'other' },
];

// ── Cost line ────────────────────────────────────────────────────────────────

export function BudgetLineDialog({
  visible,
  budget,
  line,
  prefill,
  onHide,
  onSaved,
}: {
  visible: boolean;
  budget: Budget;
  line: BudgetLine | null; // null = create
  prefill?: { name: string; category: string; kind: 'monthly' | 'one-off' } | null; // template defaults when creating
  onHide: () => void;
  onSaved: (b: Budget) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Other');
  const [amount, setAmount] = useState<number | null>(null);
  const [kind, setKind] = useState<'monthly' | 'one-off'>('monthly');
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Re-seed the form when the dialog opens. Derive-during-render (not an
  // effect) so there's no cascading render — same pattern as the mortgage
  // reconcile dialog.
  if (visible && !seeded) {
    setSeeded(true);
    setName(line?.name ?? prefill?.name ?? '');
    setCategory(line?.category ?? prefill?.category ?? 'Other');
    setAmount(line?.amount ?? null);
    setKind(line?.kind ?? prefill?.kind ?? 'monthly');
    setMonth(line?.month ?? budget.startMonth);
    setError('');
  }
  if (!visible && seeded) setSeeded(false);

  const monthCount = getMonthsBetween(budget.startMonth, budget.endMonth) + 1;

  const submit = async () => {
    setError('');
    const parsed = budgetLineSchema.safeParse({
      name,
      category,
      amount: amount ?? undefined,
      kind,
      month: kind === 'one-off' ? month || undefined : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    setSaving(true);
    const res = line
      ? await updateBudgetLine(budget.id, line.id, parsed.data)
      : await addBudgetLine(budget.id, parsed.data);
    setSaving(false);
    if (res.success && res.data) {
      onSaved(res.data);
      onHide();
    } else {
      setError(res.error ?? 'Something went wrong');
    }
  };

  return (
    <Dialog header={line ? 'Edit cost' : 'Add a cost'} visible={visible} onHide={onHide} style={{ width: '26rem' }}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">What is it?</label>
          <InputText value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent" className="w-full" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Amount</label>
            <InputNumber value={amount} onValueChange={(e) => setAmount(e.value ?? null)} mode="currency" currency={budget.currency} locale="fi-FI" className="w-full" />
          </div>
          <div>
            <label className="text-sm font-medium">Category</label>
            <Dropdown value={category} options={BUDGET_CATEGORIES} onChange={(e) => setCategory(e.value)} className="w-full" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">How often?</label>
          <SelectButton value={kind} options={KIND_OPTIONS} onChange={(e) => e.value && setKind(e.value)} allowEmpty={false} className="w-full" />
          {kind === 'monthly' && (amount ?? 0) > 0 && (
            <HelpTip text={`${formatCurrency(amount!, budget.currency)} × ${monthCount} months = ${formatCurrency(amount! * monthCount, budget.currency)}`} />
          )}
        </div>
        {kind === 'one-off' && (
          <div>
            <label className="text-sm font-medium">Which month?</label>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
        )}
        {error && <Message severity="error" text={error} className="w-full" />}
        <div className="flex justify-end gap-2 pt-1">
          <Button label="Cancel" text severity="secondary" onClick={onHide} disabled={saving} />
          <Button label={line ? 'Save' : 'Add cost'} loading={saving} onClick={submit} />
        </div>
      </div>
    </Dialog>
  );
}

// ── Funding source ───────────────────────────────────────────────────────────

export function BudgetFundingDialog({
  visible,
  budget,
  source,
  initialType,
  isSimple,
  onHide,
  onSaved,
}: {
  visible: boolean;
  budget: Budget;
  source: BudgetFundingSource | null; // null = create
  initialType?: BudgetFundingType;
  isSimple: boolean;
  onHide: () => void;
  onSaved: (b: Budget) => void;
}) {
  const [type, setType] = useState<BudgetFundingType>('grant');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [restricted, setRestricted] = useState<string[]>([]);
  const [timing, setTiming] = useState<BudgetFundingTiming>('upfront');
  const [receivedMonth, setReceivedMonth] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Re-seed on open, derive-during-render (see BudgetLineDialog).
  if (visible && !seeded) {
    setSeeded(true);
    setType(source?.type ?? initialType ?? 'grant');
    setName(source?.name ?? '');
    setAmount(source?.amount ?? null);
    setRestricted(source?.restrictedToCategories ?? []);
    setTiming(source?.timing ?? 'upfront');
    setReceivedMonth(source?.receivedMonth ?? budget.startMonth);
    setRate(source?.perDiemRate ?? null);
    setDays(source?.perDiemDays ?? getBudgetPeriodDays(budget));
    setError('');
  }
  if (!visible && seeded) setSeeded(false);

  const perDiemTotal = calcPerDiemTotal(rate ?? 0, days ?? 0);

  const submit = async () => {
    setError('');
    const parsed = budgetFundingSchema.safeParse({
      name,
      type,
      amount: type === 'per-diem' ? undefined : amount ?? undefined,
      restrictedToCategories: type === 'grant' && restricted.length > 0 ? restricted : undefined,
      timing,
      receivedMonth: timing === 'specific-month' ? receivedMonth || undefined : undefined,
      perDiemRate: type === 'per-diem' ? rate ?? undefined : undefined,
      perDiemDays: type === 'per-diem' ? days ?? undefined : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    setSaving(true);
    const res = source
      ? await updateBudgetFundingSource(budget.id, source.id, parsed.data)
      : await addBudgetFundingSource(budget.id, parsed.data);
    setSaving(false);
    if (res.success && res.data) {
      onSaved(res.data);
      onHide();
    } else {
      setError(res.error ?? 'Something went wrong');
    }
  };

  return (
    <Dialog header={source ? 'Edit funding' : 'Add funding'} visible={visible} onHide={onHide} style={{ width: '28rem' }}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">What kind of money is it?</label>
          <Dropdown value={type} options={FUNDING_TYPE_OPTIONS} onChange={(e) => setType(e.value)} className="w-full" />
        </div>
        <div>
          <label className="text-sm font-medium">Name</label>
          <InputText
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'per-diem' ? 'e.g. Per diem allowance' : type === 'grant' ? 'e.g. Kone Foundation grant' : 'e.g. Savings I’ll use'}
            className="w-full"
          />
        </div>

        {type === 'per-diem' ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Per day</label>
                <InputNumber value={rate} onValueChange={(e) => setRate(e.value ?? null)} mode="currency" currency={budget.currency} locale="fi-FI" className="w-full" />
              </div>
              <div>
                <label className="text-sm font-medium">Days</label>
                <InputNumber value={days} onValueChange={(e) => setDays(e.value ?? null)} className="w-full" />
              </div>
            </div>
            {perDiemTotal > 0 && (
              <p className="text-sm font-semibold mt-2">
                {formatCurrency(rate ?? 0, budget.currency)} × {days} days = {formatCurrency(perDiemTotal, budget.currency)}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium">Total amount</label>
            <InputNumber value={amount} onValueChange={(e) => setAmount(e.value ?? null)} mode="currency" currency={budget.currency} locale="fi-FI" className="w-full" />
          </div>
        )}

        {type === 'grant' && (
          <div>
            <label className="text-sm font-medium">What is it allowed to pay for?</label>
            <MultiSelect
              value={restricted}
              options={BUDGET_CATEGORIES}
              onChange={(e) => setRestricted(e.value)}
              placeholder="Anything"
              display="chip"
              className="w-full"
            />
            <HelpTip text="Leave empty if the grant can pay for anything. If the foundation says “travel and accommodation only”, pick just those." />
          </div>
        )}

        {!isSimple && (
          <div>
            <label className="text-sm font-medium">When does the money arrive?</label>
            <Dropdown value={timing} options={TIMING_OPTIONS} onChange={(e) => setTiming(e.value)} className="w-full" />
            {timing === 'specific-month' && (
              <div className="mt-2">
                <MonthPicker value={receivedMonth} onChange={setReceivedMonth} />
              </div>
            )}
          </div>
        )}

        {error && <Message severity="error" text={error} className="w-full" />}
        <div className="flex justify-end gap-2 pt-1">
          <Button label="Cancel" text severity="secondary" onClick={onHide} disabled={saving} />
          <Button label={source ? 'Save' : 'Add funding'} loading={saving} onClick={submit} />
        </div>
      </div>
    </Dialog>
  );
}

// ── Budget details ───────────────────────────────────────────────────────────

export function BudgetDetailsDialog({
  visible,
  budget,
  onHide,
  onSaved,
}: {
  visible: boolean;
  budget: Budget;
  onHide: () => void;
  onSaved: (b: Budget) => void;
}) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [startMonth, setStartMonth] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Re-seed on open, derive-during-render (see BudgetLineDialog).
  if (visible && !seeded) {
    setSeeded(true);
    setName(budget.name);
    setDestination(budget.destination ?? '');
    setCurrency(budget.currency);
    setStartMonth(budget.startMonth);
    setEndMonth(budget.endMonth);
    setError('');
  }
  if (!visible && seeded) setSeeded(false);

  const submit = async () => {
    setError('');
    const parsed = budgetDetailsSchema.safeParse({ name, destination, currency, startMonth, endMonth });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form');
      return;
    }
    setSaving(true);
    const res = await updateBudget(budget.id, parsed.data);
    setSaving(false);
    if (res.success && res.data) {
      onSaved(res.data);
      onHide();
    } else {
      setError(res.error ?? 'Something went wrong');
    }
  };

  return (
    <Dialog header="Edit details" visible={visible} onHide={onHide} style={{ width: '26rem' }}>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Name</label>
          <InputText value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-sm font-medium">Where? <span className="opacity-50 font-normal">(optional)</span></label>
          <InputText value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Stockholm" className="w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">From</label>
            <MonthPicker value={startMonth} onChange={setStartMonth} />
          </div>
          <div>
            <label className="text-sm font-medium">Until</label>
            <MonthPicker value={endMonth} onChange={setEndMonth} />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">Currency</label>
          <Dropdown
            value={currency}
            options={CURRENCIES.map((c) => ({ label: `${c.symbol} ${c.label}`, value: c.value }))}
            onChange={(e) => setCurrency(e.value)}
            className="w-full"
          />
          <HelpTip text="The currency you’ll mostly spend in." />
        </div>
        {error && <Message severity="error" text={error} className="w-full" />}
        <div className="flex justify-end gap-2 pt-1">
          <Button label="Cancel" text severity="secondary" onClick={onHide} disabled={saving} />
          <Button label="Save" loading={saving} onClick={submit} />
        </div>
      </div>
    </Dialog>
  );
}
