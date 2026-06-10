'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { ProgressSpinner } from 'primereact/progressspinner';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { MdFileDownload, MdMoreVert, MdPlace } from 'react-icons/md';
import { useAppContext } from '@/components/layout/app-layout';
import { getBudgetById, updateBudget, deleteBudget, unconfirmBudget } from '@/lib/actions/budgets';
import { getProjection } from '@/lib/actions/projection';
import { computeFeasibility, computeActualsRollup, getBudgetMonths } from '@/lib/budget-utils';
import { formatYearMonth, getCurrencySymbol } from '@/lib/constants';
import { BudgetVerdictCard } from '@/components/budgets/budget-verdict-card';
import { BudgetCoverageBars } from '@/components/budgets/budget-coverage-bars';
import { BudgetMonthChart } from '@/components/budgets/budget-month-chart';
import { BudgetLinesPanel, BudgetFundingPanel, type RegularIncomeInfo } from '@/components/budgets/budget-panels';
import { BudgetExpenseLog } from '@/components/budgets/budget-expense-log';
import { BudgetDetailsDialog } from '@/components/budgets/budget-dialogs';
import { BudgetConfirmDialog } from '@/components/budgets/budget-confirm-dialog';
import { BudgetExportDialog } from '@/components/budgets/budget-export-dialog';
import { statusTag } from '@/components/budgets/budget-card';
import type { Budget } from '@/types';

export default function BudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const appContext = useAppContext();
  const isSimple = appContext?.displayMode === 'simple';
  const accounts = useMemo(() => appContext?.accounts ?? [], [appContext?.accounts]);
  const toastRef = useRef<Toast>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [regularIncome, setRegularIncome] = useState<RegularIncomeInfo | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<Menu>(null);
  const hasLoadedOnce = useRef(false);

  const budgetId = params.id;

  const fetchData = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    try {
      const res = await getBudgetById(budgetId);
      if (res.success && res.data) setBudget(res.data);
      else router.push('/budgets');
    } catch (err) {
      console.error('Failed to load budget:', err);
    } finally {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, [budgetId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (appContext) appContext.setRefreshCallback(fetchData); }, [appContext, fetchData]);

  // Regular income during the period — context only, never part of the budget math.
  const incomeAccountId = budget?.linkedAccountId ?? accounts[0]?.id;
  const includeRegularIncome = budget?.includeRegularIncome;
  const startMonth = budget?.startMonth;
  const endMonth = budget?.endMonth;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!includeRegularIncome || !incomeAccountId || !startMonth || !endMonth) {
        setRegularIncome(null);
        return;
      }
      const account = accounts.find(a => a.id === incomeAccountId);
      if (!account) {
        setRegularIncome(null);
        return;
      }
      const res = await getProjection(incomeAccountId, { startDate: startMonth, endDate: endMonth });
      if (cancelled || !res.success || !res.data) return;
      const months = res.data.monthly;
      if (months.length === 0) {
        setRegularIncome(null);
        return;
      }
      // Exclude this feature's own injected lines to avoid circularity once confirmed.
      const totalIncome = months.reduce(
        (sum, m) => sum + m.incomeBreakdown.filter(i => i.source !== 'budget').reduce((s, i) => s + i.amount, 0),
        0
      );
      const expectedMonths = getBudgetMonths({ startMonth, endMonth } as Budget).length;
      setRegularIncome({
        monthlyAverage: totalIncome / months.length,
        currency: account.currency,
        accountName: account.name,
        partial: months.length < expectedMonths,
      });
    })();
    return () => { cancelled = true; };
  }, [includeRegularIncome, incomeAccountId, startMonth, endMonth, accounts]);

  const feasibility = useMemo(() => (budget ? computeFeasibility(budget) : null), [budget]);
  const rollup = useMemo(() => (budget ? computeActualsRollup(budget) : null), [budget]);

  const toast = (msg: string, severity: 'success' | 'error' = 'success') =>
    toastRef.current?.show({ severity, summary: severity === 'success' ? 'Done' : 'Error', detail: msg, life: 3000 });

  if (isLoading || !budget || !feasibility || !rollup) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <ProgressSpinner />
      </div>
    );
  }

  const tag = statusTag(budget);
  const hasCoverage = feasibility.totalCosts > 0 && feasibility.totalFunding > 0;
  const missingLinkedAccount = budget.status === 'confirmed' && budget.linkedAccountId && !accounts.some(a => a.id === budget.linkedAccountId);

  const handleUnconfirm = () =>
    confirmDialog({
      message: 'Take this budget out of your cashflow? The budget itself is kept — nothing is deleted.',
      header: 'Remove from cashflow',
      acceptLabel: 'Remove it',
      rejectLabel: 'Keep it there',
      accept: async () => {
        const res = await unconfirmBudget(budget.id);
        if (res.success && res.data) {
          setBudget(res.data);
          toast('Removed from your cashflow');
        } else {
          toast(res.error ?? 'Something went wrong', 'error');
        }
      },
    });

  const handleArchive = async () => {
    const res = await updateBudget(budget.id, { isArchived: !budget.isArchived });
    if (res.success && res.data) {
      setBudget(res.data);
      toast(res.data.isArchived ? 'Archived — it no longer shows in your cashflow' : 'Unarchived');
    } else {
      toast(res.error ?? 'Something went wrong', 'error');
    }
  };

  const handleDelete = () =>
    confirmDialog({
      message: 'Delete this budget and everything in it — costs, funding and the spending log? This cannot be undone.',
      header: 'Delete budget',
      acceptLabel: 'Delete forever',
      rejectLabel: 'Keep it',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        const res = await deleteBudget(budget.id);
        if (res.success) router.push('/budgets');
        else toast(res.error ?? 'Something went wrong', 'error');
      },
    });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Toast ref={toastRef} />
      <ConfirmDialog />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{budget.name}</h1>
            <Tag value={budget.isArchived ? 'Archived' : tag.value} severity={budget.isArchived ? 'secondary' : tag.severity} />
          </div>
          <p className="text-sm opacity-60 mt-0.5 flex items-center gap-1 flex-wrap">
            {budget.destination && (
              <>
                <MdPlace size={14} /> {budget.destination} ·
              </>
            )}
            {formatYearMonth(budget.startMonth)} – {formatYearMonth(budget.endMonth)} · {getCurrencySymbol(budget.currency)} ({budget.currency})
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button label="Export for reporting" icon={<MdFileDownload />} outlined size="small" onClick={() => setExportOpen(true)} />
          <Button icon={<MdMoreVert />} text severity="secondary" onClick={(e) => menuRef.current?.toggle(e)} />
          <Menu
            ref={menuRef}
            popup
            model={[
              { label: 'Edit details', command: () => setDetailsOpen(true) },
              { label: budget.isArchived ? 'Unarchive' : 'Archive', command: handleArchive },
              { separator: true },
              { label: 'Delete…', command: handleDelete },
            ]}
          />
        </div>
      </div>

      {missingLinkedAccount && (
        <div className="p-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 text-sm">
          The account this budget was linked to no longer exists, so it isn&apos;t showing in any cashflow. Remove it
          from your cashflow and add it again to pick a new account.
        </div>
      )}

      {/* Verdict */}
      <BudgetVerdictCard
        budget={budget}
        feasibility={feasibility}
        onConfirmClick={() => setConfirmOpen(true)}
        onUnconfirmClick={handleUnconfirm}
      />

      {/* Who pays for what */}
      {hasCoverage && (
        <Card>
          <h3 className="text-base font-semibold mb-3">Who pays for what</h3>
          <BudgetCoverageBars allocation={feasibility.allocation} currency={budget.currency} />
        </Card>
      )}

      {/* Costs & funding */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <BudgetLinesPanel budget={budget} onChanged={setBudget} />
        <BudgetFundingPanel
          budget={budget}
          allocation={feasibility.allocation}
          isSimple={!!isSimple}
          regularIncome={regularIncome}
          onToggleRegularIncome={async (include) => {
            const res = await updateBudget(budget.id, { includeRegularIncome: include });
            if (res.success && res.data) setBudget(res.data);
          }}
          onChanged={setBudget}
        />
      </div>

      {/* Month by month (advanced mode) */}
      {!isSimple && feasibility.totalCosts > 0 && feasibility.perMonth.length > 1 && (
        <Card>
          <h3 className="text-base font-semibold mb-3">Month by month</h3>
          <BudgetMonthChart perMonth={feasibility.perMonth} currency={budget.currency} />
        </Card>
      )}

      {/* Spending log */}
      <BudgetExpenseLog budget={budget} rollup={rollup} onChanged={setBudget} />

      {/* Dialogs */}
      <BudgetDetailsDialog visible={detailsOpen} budget={budget} onHide={() => setDetailsOpen(false)} onSaved={setBudget} />
      <BudgetConfirmDialog
        visible={confirmOpen}
        budget={budget}
        accounts={accounts}
        onHide={() => setConfirmOpen(false)}
        onConfirmed={(b) => {
          setBudget(b);
          toast('Added to your cashflow — your forecast now includes this budget');
        }}
      />
      <BudgetExportDialog visible={exportOpen} budget={budget} onHide={() => setExportOpen(false)} />
    </div>
  );
}
