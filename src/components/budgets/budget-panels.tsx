'use client';

import { useState } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { InputSwitch } from 'primereact/inputswitch';
import { confirmDialog } from 'primereact/confirmdialog';
import { MdAdd, MdDelete } from 'react-icons/md';
import { formatCurrency, formatYearMonthShort } from '@/lib/constants';
import { getMonthsBetween } from '@/lib/projection';
import { deleteBudgetLine, deleteBudgetFundingSource } from '@/lib/actions/budgets';
import { BudgetLineDialog, BudgetFundingDialog } from './budget-dialogs';
import { BUDGET_TEMPLATES } from './budget-templates';
import type { Budget, BudgetLine, BudgetFundingSource, BudgetFundingType, Currency } from '@/types';
import type { FundingAllocation } from '@/lib/budget-utils';

const FUNDING_TYPE_LABELS: Record<BudgetFundingType, string> = {
  grant: 'Grant',
  'per-diem': 'Daily allowance',
  other: 'Other',
};

function PanelRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      className="flex justify-between items-center px-2 py-1.5 rounded cursor-pointer transition-colors text-sm hover:bg-black/5 dark:hover:bg-white/10 group"
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function DeleteRowButton({ onDelete }: { onDelete: () => void }) {
  return (
    <Button
      icon={<MdDelete />}
      text
      severity="danger"
      size="small"
      className="!p-1 opacity-0 group-hover:opacity-100 shrink-0"
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
    />
  );
}

// ── "What it costs" ──────────────────────────────────────────────────────────

export function BudgetLinesPanel({
  budget,
  onChanged,
}: {
  budget: Budget;
  onChanged: (b: Budget) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editLine, setEditLine] = useState<BudgetLine | null>(null);
  const [template, setTemplate] = useState<{ name: string; category: string; kind: 'monthly' | 'one-off' } | null>(null);

  const monthCount = getMonthsBetween(budget.startMonth, budget.endMonth) + 1;
  const total = budget.lines.reduce(
    (sum, l) => sum + l.amount * (l.kind === 'monthly' ? monthCount : 1),
    0
  );

  const openCreate = (prefill?: { name: string; category: string; kind: 'monthly' | 'one-off' }) => {
    setEditLine(null);
    setTemplate(prefill ?? null);
    setDialogOpen(true);
  };

  const handleDelete = (line: BudgetLine) =>
    confirmDialog({
      message: `Remove “${line.name}”?`,
      header: 'Remove cost',
      acceptLabel: 'Remove',
      rejectLabel: 'Keep it',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        const res = await deleteBudgetLine(budget.id, line.id);
        if (res.success && res.data) onChanged(res.data);
      },
    });

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold">What it costs</h3>
        <Button label="Add" icon={<MdAdd />} text size="small" onClick={() => openCreate()} />
      </div>

      {budget.lines.length === 0 ? (
        <div>
          <p className="text-sm opacity-60 mb-3">Add your first cost — rough guesses are fine.</p>
          <div className="flex flex-wrap gap-2">
            {BUDGET_TEMPLATES.map(t => (
              <Button key={t.name} label={`+ ${t.name}`} outlined size="small" className="!py-1 !px-2 !text-xs" onClick={() => openCreate(t)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-0">
          {budget.lines.map(line => (
            <PanelRow key={line.id} onClick={() => { setEditLine(line); setTemplate(null); setDialogOpen(true); }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{line.name}</span>
                <Tag value={line.category} severity="warning" className="text-xs !py-0 !px-1" />
              </div>
              <div className="flex items-center gap-1 whitespace-nowrap ml-2">
                <span>
                  {formatCurrency(line.amount, budget.currency)}
                  <span className="opacity-50 text-xs ml-1">
                    {line.kind === 'monthly' ? '/ month' : formatYearMonthShort(line.month ?? budget.startMonth)}
                  </span>
                </span>
                <DeleteRowButton onDelete={() => handleDelete(line)} />
              </div>
            </PanelRow>
          ))}
          <div className="flex justify-between items-center px-2 pt-2 mt-1 border-t surface-border text-sm font-semibold">
            <span>Total for the whole period</span>
            <span>{formatCurrency(total, budget.currency)}</span>
          </div>
        </div>
      )}

      <BudgetLineDialog
        visible={dialogOpen}
        budget={budget}
        line={editLine}
        prefill={template}
        onHide={() => setDialogOpen(false)}
        onSaved={onChanged}
      />
    </Card>
  );
}

// ── "Who's paying" ───────────────────────────────────────────────────────────

export interface RegularIncomeInfo {
  monthlyAverage: number;
  currency: Currency;
  accountName: string;
  partial: boolean; // account projection ends before the budget does
}

export function BudgetFundingPanel({
  budget,
  allocation,
  isSimple,
  regularIncome,
  onToggleRegularIncome,
  onChanged,
}: {
  budget: Budget;
  allocation: FundingAllocation;
  isSimple: boolean;
  regularIncome: RegularIncomeInfo | null;
  onToggleRegularIncome: (include: boolean) => void;
  onChanged: (b: Budget) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSource, setEditSource] = useState<BudgetFundingSource | null>(null);
  const [initialType, setInitialType] = useState<BudgetFundingType>('grant');

  const openCreate = (type: BudgetFundingType) => {
    setEditSource(null);
    setInitialType(type);
    setDialogOpen(true);
  };

  const handleDelete = (source: BudgetFundingSource) =>
    confirmDialog({
      message: `Remove “${source.name}”? Logged expenses stay — they just won’t be tied to this money anymore.`,
      header: 'Remove funding',
      acceptLabel: 'Remove',
      rejectLabel: 'Keep it',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        const res = await deleteBudgetFundingSource(budget.id, source.id);
        if (res.success && res.data) onChanged(res.data);
      },
    });

  const surplusById = new Map(allocation.perSource.map(s => [s.sourceId, s.unusableSurplus]));

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold">Who&apos;s paying</h3>
        <Button label="Add" icon={<MdAdd />} text size="small" onClick={() => openCreate('grant')} />
      </div>

      {budget.fundingSources.length === 0 ? (
        <div>
          <p className="text-sm opacity-60 mb-3">Add grants or allowances to see what gets covered.</p>
          <div className="flex flex-wrap gap-2">
            <Button label="+ A grant or stipend" outlined size="small" className="!py-1 !px-2 !text-xs" onClick={() => openCreate('grant')} />
            <Button label="+ A daily allowance" outlined size="small" className="!py-1 !px-2 !text-xs" onClick={() => openCreate('per-diem')} />
            <Button label="+ Something else" outlined size="small" className="!py-1 !px-2 !text-xs" onClick={() => openCreate('other')} />
          </div>
        </div>
      ) : (
        <div className="space-y-0">
          {budget.fundingSources.map(source => {
            const surplus = surplusById.get(source.id) ?? 0;
            const restricted = source.restrictedToCategories ?? [];
            return (
              <PanelRow key={source.id} onClick={() => { setEditSource(source); setDialogOpen(true); }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{source.name}</span>
                    <Tag value={FUNDING_TYPE_LABELS[source.type]} severity="info" className="text-xs !py-0 !px-1" />
                  </div>
                  {restricted.length > 0 && (
                    <p className="text-xs opacity-50">only for {restricted.join(', ')}</p>
                  )}
                  {surplus > 0.005 && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      {formatCurrency(surplus, budget.currency)} can&apos;t be used — your costs in those categories are smaller
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap ml-2">
                  <span className="text-green-600">+{formatCurrency(source.amount, budget.currency)}</span>
                  <DeleteRowButton onDelete={() => handleDelete(source)} />
                </div>
              </PanelRow>
            );
          })}
        </div>
      )}

      {/* Regular income — automatic, read-only context */}
      <div className="flex justify-between items-center px-2 py-1.5 mt-2 border-t surface-border text-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="opacity-80">Your usual income</span>
            <Tag value="automatic" severity="secondary" className="text-xs !py-0 !px-1" />
          </div>
          {budget.includeRegularIncome && regularIncome && (
            <p className="text-xs opacity-50">
              about {formatCurrency(regularIncome.monthlyAverage, regularIncome.currency)}/month from {regularIncome.accountName}
              {regularIncome.partial && ' (partial — the account forecast ends sooner)'}
              {' '}— shown for context, it keeps arriving either way
            </p>
          )}
          {budget.includeRegularIncome && !regularIncome && (
            <p className="text-xs opacity-50">your salary keeps arriving while you&apos;re away</p>
          )}
        </div>
        <InputSwitch checked={budget.includeRegularIncome} onChange={(e) => onToggleRegularIncome(!!e.value)} />
      </div>

      <BudgetFundingDialog
        visible={dialogOpen}
        budget={budget}
        source={editSource}
        initialType={initialType}
        isSimple={isSimple}
        onHide={() => setDialogOpen(false)}
        onSaved={onChanged}
      />
    </Card>
  );
}
