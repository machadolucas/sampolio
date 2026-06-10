'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { SelectButton } from 'primereact/selectbutton';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Toast } from 'primereact/toast';
import { MdHouse, MdPercent, MdMoreVert } from 'react-icons/md';
import { useAppContext } from '@/components/layout/app-layout';
import { useTheme } from '@/components/providers/theme-provider';
import { getMyMortgages, getMortgageProjectionInputs, deleteMortgage, revertMortgageMonth } from '@/lib/actions/shared-mortgages';
import type { MortgageProjectionInputsResult } from '@/lib/actions/shared-mortgages';
import { calculateMortgageProjection, getMortgageStartDate, getPayoffMonth } from '@/lib/mortgage-projection';
import { isEuriborUpdateDue } from '@/lib/mortgage-utils';
import { addMonths, compareYearMonths, getCurrentYearMonth, getMonthsBetween } from '@/lib/projection';
import type { TimeHorizon } from '@/types';
import { MortgageHeroCard, OwnershipBalancePanel, SubLoanCard } from '@/components/mortgage/mortgage-panels';
import { MortgageLedgerTable } from '@/components/mortgage/mortgage-ledger-table';
import { MortgageHistoryStrips } from '@/components/mortgage/mortgage-history-strips';
import { MortgageSetupWizard } from '@/components/mortgage/mortgage-setup-wizard';
import { MortgageImportDialog } from '@/components/mortgage/mortgage-import-dialog';
import { MortgageReconcileDialog } from '@/components/mortgage/mortgage-reconcile-dialog';
import { EuriborUpdateDialog, DriftAdjustmentDialog, ExtraPaymentDialog, MortgageMembersDialog } from '@/components/mortgage/mortgage-dialogs';
import {
  MortgageBalanceChart,
  OwnershipProgressChart,
  PrincipalInterestChart,
  CumulativeCostChart,
  RateHistoryChart,
  PaymentBreakdownChart,
  EquityBuildupChart,
} from '@/components/mortgage/mortgage-charts';

const HORIZON_OPTIONS = [
  { label: '1Y', value: '1y' },
  { label: '3Y', value: '3y' },
  { label: '5Y', value: '5y' },
  { label: 'All', value: 'custom' },
];
const HORIZON_MONTHS: Record<string, number> = { '6m': 6, '1y': 12, '3y': 36, '5y': 60 };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 className="text-base font-semibold mb-3">{title}</h3>
      {children}
    </Card>
  );
}

export default function MortgagePage() {
  const { data: session } = useSession();
  const appContext = useAppContext();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isSimple = appContext?.displayMode === 'simple';
  const userId = session?.user?.id;
  const toastRef = useRef<Toast>(null);
  const menuRef = useRef<Menu>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [inputs, setInputs] = useState<MortgageProjectionInputsResult | null>(null);
  const [horizon, setHorizon] = useState<TimeHorizon>('5y');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [euriborOpen, setEuriborOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reconcileYM, setReconcileYM] = useState<string | null>(null);

  const currentMonth = getCurrentYearMonth();
  const hasLoadedOnce = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    try {
      const res = await getMyMortgages();
      const active = res.success && res.data ? res.data.filter((m) => !m.isArchived) : [];
      if (active.length === 0) {
        setInputs(null);
      } else {
        const inputRes = await getMortgageProjectionInputs(active[0].id);
        if (inputRes.success && inputRes.data) setInputs(inputRes.data);
      }
    } catch (err) {
      console.error('Failed to load mortgage:', err);
    } finally {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (appContext) appContext.setRefreshCallback(fetchData); }, [appContext, fetchData]);

  const toast = (msg: string, severity: 'success' | 'error' = 'success') =>
    toastRef.current?.show({ severity, summary: severity === 'success' ? 'Done' : 'Error', detail: msg, life: 3000 });

  // Compute the full schedule.
  const { months, payoffMonth } = useMemo(() => {
    if (!inputs) return { months: [], payoffMonth: null as string | null };
    const genesis = getMortgageStartDate(inputs.mortgage);
    const maxTerm = Math.max(...inputs.mortgage.loans.map((l) => l.originalTermMonths), 12);
    const end = addMonths(genesis, maxTerm + 24);
    const m = calculateMortgageProjection(inputs, end);
    return { months: m, payoffMonth: getPayoffMonth(m) };
  }, [inputs]);

  const euriborDue = useMemo(
    () => (inputs ? isEuriborUpdateDue(inputs.mortgage, inputs.rates) : null),
    [inputs]
  );

  // Time-windowed slice for the forward-looking charts.
  const windowedMonths = useMemo(() => {
    if (horizon === 'custom') return months;
    const end = addMonths(currentMonth, HORIZON_MONTHS[horizon] ?? 60);
    return months.filter((m) => compareYearMonths(m.yearMonth, end) <= 0);
  }, [months, horizon, currentMonth]);

  const currentRow = useMemo(
    () => months.find((m) => m.yearMonth === currentMonth) ?? [...months].reverse().find((m) => m.isHistorical),
    [months, currentMonth]
  );

  const previewLoans = useMemo(() => {
    if (!inputs || !currentRow) return [];
    return inputs.mortgage.loans.map((loan) => {
      const lr = currentRow.loans.find((l) => l.loanId === loan.id);
      const monthsSinceStart = getMonthsBetween(loan.startDate, currentMonth);
      return {
        label: loan.label,
        balance: lr?.endingPrincipal ?? loan.initialPrincipal,
        remainingMonths: Math.max(1, loan.originalTermMonths - monthsSinceStart),
        margin: loan.margin,
      };
    });
  }, [inputs, currentRow, currentMonth]);

  const expectedByLoan = useMemo(() => {
    const map: Record<string, number> = {};
    if (currentRow) for (const l of currentRow.loans) map[l.loanId] = l.endingPrincipal;
    return map;
  }, [currentRow]);

  const handleDelete = async () => {
    if (!inputs) return;
    if (!confirm('Delete this mortgage for all members? This cannot be undone.')) return;
    const res = await deleteMortgage(inputs.mortgage.id);
    if (res.success) { toast('Mortgage deleted'); fetchData(); }
    else toast(res.error ?? 'Failed to delete', 'error');
  };

  const reconcileMonth = useMemo(
    () => (reconcileYM ? months.find((m) => m.yearMonth === reconcileYM) ?? null : null),
    [reconcileYM, months]
  );

  const handleRevert = async (yearMonth: string) => {
    if (!inputs) return;
    if (!confirm(`Revert ${yearMonth} back to a forecast? Its recorded figures will be removed.`)) return;
    const res = await revertMortgageMonth(inputs.mortgage.id, yearMonth);
    if (res.success) { toast(`${yearMonth} reverted to forecast`); fetchData(); }
    else toast(res.error ?? 'Failed to revert', 'error');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh]"><ProgressSpinner style={{ width: '50px', height: '50px' }} /></div>;
  }

  // Empty state
  if (!inputs) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <Toast ref={toastRef} />
        <div className={`inline-flex p-4 rounded-full mb-4 ${isDark ? 'bg-gray-800' : 'bg-gray-100'} text-blue-500 text-3xl`}>
          <MdHouse />
        </div>
        <h1 className="text-3xl font-bold mb-2">Track your home loan together</h1>
        <p className="opacity-70 mb-6 max-w-md mx-auto">
          Set up your mortgage once — its loans, the yearly Euribor rate, and your down payments — and Sampolio shows
          the full payment schedule, who owns how much, and your path to an equal split. Share it with your partner so
          you both see the same picture.
        </p>
        <Button label="Set up your mortgage" icon={<MdHouse />} onClick={() => setSetupOpen(true)} />
        <MortgageSetupWizard visible={setupOpen} isSimple={!!isSimple} onClose={() => setSetupOpen(false)} onCreated={() => { setSetupOpen(false); toast('Mortgage created'); fetchData(); }} />
      </div>
    );
  }

  const mortgage = inputs.mortgage;
  const partner = mortgage.members.find((m) => m.userId !== userId);

  const menuItems = [
    { label: 'Import actual history', icon: 'pi pi-upload', command: () => setImportOpen(true) },
    { label: 'Manage members', icon: 'pi pi-users', command: () => setMembersOpen(true) },
    { label: 'Make an extra payment', icon: 'pi pi-plus-circle', command: () => setExtraOpen(true) },
    { label: 'Correct a balance', icon: 'pi pi-sync', command: () => setDriftOpen(true) },
    { separator: true },
    { label: 'Delete mortgage', icon: 'pi pi-trash', command: handleDelete },
  ];

  return (
    <div className="space-y-6 max-w-360 mx-auto py-8">
      <Toast ref={toastRef} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-4xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{mortgage.name}</h1>
          <p className="text-sm opacity-60 mt-1">
            {partner ? `Shared with ${partner.name}` : 'Not shared yet — invite your partner'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            label="Update Euribor rate"
            icon={<MdPercent />}
            severity={euriborDue?.due ? 'warning' : 'secondary'}
            outlined={!euriborDue?.due}
            onClick={() => setEuriborOpen(true)}
          />
          <Button icon={<MdMoreVert />} text severity="secondary" onClick={(e) => menuRef.current?.toggle(e)} aria-label="More" />
          <Menu model={menuItems} popup ref={menuRef} />
        </div>
      </div>

      {/* Euribor reminder banner */}
      {euriborDue?.due && (
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${isDark ? 'bg-yellow-900/20 border-yellow-800 text-yellow-400' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>
          <MdPercent size={20} />
          <span>Time to update your Euribor rate for this year. Banks reset it around {euriborDue.lastResetDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} — enter the new 12-month Euribor so your payments stay accurate.</span>
          <Button label="Update rate" size="small" severity="warning" className="ml-auto" onClick={() => setEuriborOpen(true)} />
        </div>
      )}

      {/* Hero */}
      <MortgageHeroCard months={months} mortgage={mortgage} currency={mortgage.currency} currentMonth={currentMonth} nextResetDate={euriborDue?.nextResetDate ?? new Date()} payoffMonth={payoffMonth} />

      {/* Ownership */}
      <OwnershipBalancePanel months={months} mortgage={mortgage} currency={mortgage.currency} currentUserId={userId} currentMonth={currentMonth} isSimple={!!isSimple} />

      {/* Sub-loans */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mortgage.loans.map((loan) => (
          <SubLoanCard key={loan.id} loan={loan} months={months} currency={mortgage.currency} currentMonth={currentMonth} isSimple={!!isSimple} />
        ))}
      </div>

      {/* Charts */}
      <div className="flex items-center justify-end">
        <SelectButton value={horizon} options={HORIZON_OPTIONS} onChange={(e) => e.value && setHorizon(e.value)} className="text-sm" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="What you still owe, over time"><MortgageBalanceChart months={windowedMonths} mortgage={mortgage} currency={mortgage.currency} /></ChartCard>
        <ChartCard title={`Path to owning the home ${mortgage.members.map((m) => Math.round(m.ownershipTargetPercent * 100)).join('/')}`}><OwnershipProgressChart months={windowedMonths} mortgage={mortgage} currency={mortgage.currency} /></ChartCard>
        {!isSimple && (
          <>
            <ChartCard title="Where each payment goes"><PrincipalInterestChart months={months} currency={mortgage.currency} /></ChartCard>
            <ChartCard title="What the loan has cost you so far"><CumulativeCostChart months={windowedMonths} currency={mortgage.currency} /></ChartCard>
            <ChartCard title="How your rate has changed"><RateHistoryChart months={windowedMonths} mortgage={mortgage} /></ChartCard>
            <ChartCard title="This month's payment, broken down"><PaymentBreakdownChart month={currentRow} currency={mortgage.currency} /></ChartCard>
          </>
        )}
        <ChartCard title="Your home equity, growing"><EquityBuildupChart months={windowedMonths} mortgage={mortgage} currency={mortgage.currency} /></ChartCard>
      </div>

      {/* Ledger */}
      <Card>
        <MortgageLedgerTable
          months={months}
          mortgage={mortgage}
          currency={mortgage.currency}
          showBreakdown={showBreakdown}
          onToggleBreakdown={setShowBreakdown}
          isSimple={!!isSimple}
          onReconcile={setReconcileYM}
          onRevert={handleRevert}
        />
      </Card>

      {/* History strips */}
      {!isSimple && (
        <MortgageHistoryStrips
          mortgage={mortgage}
          rates={inputs.rates}
          costs={inputs.costs}
          currency={mortgage.currency}
          onChanged={(msg) => { toast(msg); fetchData(); }}
        />
      )}

      {/* Dialogs */}
      <EuriborUpdateDialog
        visible={euriborOpen}
        mortgageId={mortgage.id}
        defaultEffectiveMonth={euriborDue?.resetYearMonth ?? currentMonth}
        lastEuribor={inputs.rates[inputs.rates.length - 1]?.euriborRate ?? 0}
        previewLoans={previewLoans}
        currency={mortgage.currency}
        onClose={() => setEuriborOpen(false)}
        onSaved={(msg) => { setEuriborOpen(false); toast(msg); fetchData(); }}
      />
      <DriftAdjustmentDialog
        visible={driftOpen}
        mortgageId={mortgage.id}
        loans={mortgage.loans.map((l) => ({ id: l.id, label: l.label }))}
        expectedByLoan={expectedByLoan}
        currency={mortgage.currency}
        onClose={() => setDriftOpen(false)}
        onSaved={(msg) => { setDriftOpen(false); toast(msg); fetchData(); }}
      />
      <ExtraPaymentDialog
        visible={extraOpen}
        mortgageId={mortgage.id}
        loans={mortgage.loans.map((l) => ({ id: l.id, label: l.label }))}
        currency={mortgage.currency}
        onClose={() => setExtraOpen(false)}
        onSaved={(msg) => { setExtraOpen(false); toast(msg); fetchData(); }}
      />
      <MortgageMembersDialog
        visible={membersOpen}
        mortgage={mortgage}
        currentUserId={userId}
        onClose={() => setMembersOpen(false)}
        onChanged={(msg) => { toast(msg); fetchData(); }}
      />
      <MortgageImportDialog
        visible={importOpen}
        mortgage={mortgage}
        hasActuals={inputs.actuals.length > 0}
        onClose={() => setImportOpen(false)}
        onImported={(msg) => { setImportOpen(false); toast(msg); fetchData(); }}
      />
      <MortgageReconcileDialog
        visible={reconcileYM !== null}
        month={reconcileMonth}
        mortgage={mortgage}
        currency={mortgage.currency}
        onClose={() => setReconcileYM(null)}
        onSaved={(msg) => { setReconcileYM(null); toast(msg); fetchData(); }}
      />
    </div>
  );
}
