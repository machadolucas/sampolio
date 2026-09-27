'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { SelectButton } from 'primereact/selectbutton';
import { KpiGridSkeleton } from '@/components/ui/skeletons';
import { Tag } from 'primereact/tag';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import { getOverviewData, type OverviewData } from '@/lib/actions/dashboard-data';
import {
    assembleWealthProjection,
    currentCashBalances,
    pickBudgetBanner,
    summarizeCardCredit,
    type WealthAssembly,
} from '@/lib/wealth-assembly';
import { deriveHeroSummary, netWorthChangeVsLastMonth } from '@/lib/overview-hero';
import type { FinancialAccount, TimeHorizon, Currency } from '@/types';
import { StatusHeroCard } from '@/components/ui/status-hero-card';
import { KpiTile } from '@/components/ui/kpi-tile';
import { AlertBanner } from '@/components/ui/alert-banner';
import { BannerStack, isCheckInBannerVisible } from '@/components/overview/banner-stack';
import { KpiGroup } from '@/components/overview/kpi-group';
import { NetWorthExplainDialog } from '@/components/overview/net-worth-explain-dialog';
import { WealthDistribution } from '@/components/overview/wealth-distribution';
import { plainTerm, helpText } from '@/lib/plain-language';
import { PlanCheckCard } from '@/components/overview/forecast-vs-actual-card';
import { MdSync, MdShowChart, MdEuro, MdAccountBalanceWallet, MdBarChart, MdGroup, MdCreditCard, MdArrowForward, MdAddCircle, MdRemoveCircle, MdHouse, MdHomeWork, MdErrorOutline } from 'react-icons/md';

// Chart.js (primereact/chart) is heavy and client-only — code-split both charts
// so they leave the Overview route's first-load JS. Imported from their own
// modules (never a barrel that would drag in the ECharts charts' side effects).
const ChartLoading = () => <div className="h-72 lg:h-96 rounded-lg bg-gray-100 dark:bg-gray-800/50 animate-pulse" />;
const NetWorthChart = dynamic(
    () => import('@/components/charts/net-worth-chart').then((m) => m.NetWorthChart),
    { ssr: false, loading: ChartLoading },
);
// The entity drawer is large and only opens on a KPI tap — load it on demand.
const EntityListDrawer = dynamic(
    () => import('@/components/ui/entity-list-drawer').then((m) => m.EntityListDrawer),
    { ssr: false },
);
const WealthChart = dynamic(
    () => import('@/components/charts/wealth-chart').then((m) => m.WealthChart),
    { ssr: false, loading: ChartLoading },
);

type EntityCategory = 'cash' | 'investments' | 'receivables' | 'debts';

/** Derive the display currency from the primary (first non-archived) account, default EUR */
function getPrimaryCurrency(accounts: FinancialAccount[]): Currency {
    const primary = accounts.find(a => !a.isArchived);
    return primary?.currency ?? 'EUR';
}

/** Check if accounts span multiple currencies */
function hasMixedCurrencies(accounts: FinancialAccount[]): boolean {
    const currencies = new Set(accounts.filter(a => !a.isArchived).map(a => a.currency));
    return currencies.size > 1;
}

const HORIZON_OPTIONS = [
    { label: '6M', value: '6m' },
    { label: '1Y', value: '1y' },
    { label: '3Y', value: '3y' },
    { label: '5Y', value: '5y' },
];

const SCOPE_OPTIONS = [
    { label: 'Total assets', value: 'total' },
    { label: 'Liquid', value: 'liquid' },
];

export default function OverviewPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const appContext = useAppContext();
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [isLoading, setIsLoading] = useState(true);
    const [horizon, setHorizon] = useState<TimeHorizon>('1y');
    const [showBreakdown, setShowBreakdown] = useState(true);
    // 'total' folds in mortgage equity/split balance; 'liquid' is cash + investments only.
    const [wealthScope, setWealthScope] = useState<'liquid' | 'total'>('total');
    // Simple mode: the grouped KPI grid stays collapsed behind "See all balances".
    const [showAllKpis, setShowAllKpis] = useState(false);
    const [entityDrawer, setEntityDrawer] = useState<{ visible: boolean; category: EntityCategory }>({ visible: false, category: 'cash' });
    // Latched on first open so the lazily loaded drawer keeps its close animation.
    const [entityDrawerMounted, setEntityDrawerMounted] = useState(false);
    if (entityDrawer.visible && !entityDrawerMounted) setEntityDrawerMounted(true);
    // Plain-words net-worth breakdown, opened by tapping the Net Worth KPI.
    const [explainNetWorthVisible, setExplainNetWorthVisible] = useState(false);
    const displayMode = appContext?.displayMode ?? 'advanced';
    const isSimple = displayMode === 'simple';

    // The last SUCCESSFUL load: raw inputs + the assembled wealth projection.
    // A failed refresh keeps it on screen (with an error banner) rather than
    // replacing it with totals computed from missing data.
    const [snapshot, setSnapshot] = useState<{ data: OverviewData; assembly: WealthAssembly } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);

    const userId = session?.user?.id;

    const hasLoadedOnce = useRef(false);

    const fetchData = useCallback(async () => {
        if (!hasLoadedOnce.current) {
            setIsLoading(true);
        }
        try {
            // One aggregate read (one round trip) instead of ~30 serial actions.
            const res = await getOverviewData();
            if (!res.success || !res.data) {
                setLoadError(res.error || "Couldn't load the overview. Try again.");
                return;
            }
            const now = new Date();
            const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const assembly = assembleWealthProjection(res.data.wealth, userId, startDate, 60, now);
            setSnapshot({ data: res.data, assembly });
            setLoadError(null);
        } catch (err) {
            console.error('Failed to fetch data:', err);
            setLoadError("Couldn't load the overview. Check your connection and try again.");
        } finally {
            if (!hasLoadedOnce.current) {
                hasLoadedOnce.current = true;
                setIsLoading(false);
            }
        }
    }, [userId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Register refresh callback
    useEffect(() => {
        if (appContext) {
            appContext.setRefreshCallback(fetchData);
        }
    }, [appContext, fetchData]);

    const handleRetry = useCallback(async () => {
        setRetrying(true);
        try {
            await fetchData();
        } finally {
            setRetrying(false);
        }
    }, [fetchData]);

    // Everything below derives from the last successful snapshot.
    const wealth = snapshot?.data.wealth;
    const accounts = useMemo(() => wealth?.accounts ?? [], [wealth]);
    const investments = useMemo(() => wealth?.investments ?? [], [wealth]);
    const receivables = useMemo(() => wealth?.receivables ?? [], [wealth]);
    const debts = useMemo(() => wealth?.debts ?? [], [wealth]);
    const projection = useMemo(() => snapshot?.assembly.months ?? [], [snapshot]);
    const cashCurrentBalances = useMemo(() => (wealth ? currentCashBalances(wealth) : new Map<string, number>()), [wealth]);
    const { outstandingTotal: cardLiabilitiesTotal, credit: cardCredit } = useMemo(
        () => summarizeCardCredit(wealth?.cardLiabilities ?? []),
        [wealth]
    );
    const splitNetTotal = (wealth?.splitNetCents ?? 0) / 100;
    const mortgageSummary = snapshot?.assembly.mortgageSlice ?? null;
    const euriborDue = snapshot?.assembly.euriborDue ?? null;
    const lastReconciled = snapshot?.data.lastReconciledMonth ?? null;
    const bankAttention = snapshot?.data.bankAttention ?? [];
    const checkInRemindersEnabled = snapshot?.data.checkInRemindersEnabled ?? true;
    // The "Plan check" card compares the primary account's plan against its
    // bank-actual history (the aggregate only reconstructs it for that account).
    const planCheck = useMemo(() => {
        const primaryId = wealth?.accounts[0]?.id;
        return primaryId ? wealth?.cashProjections[primaryId] ?? null : null;
    }, [wealth]);

    const displayCurrency = useMemo(() => getPrimaryCurrency(accounts), [accounts]);
    const isMixedCurrency = useMemo(() => hasMixedCurrencies(accounts), [accounts]);

    // Current month
    const currentYearMonth = useMemo(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }, []);

    const budgetBanner = useMemo(
        () => pickBudgetBanner(snapshot?.data.budgets ?? [], currentYearMonth),
        [snapshot, currentYearMonth]
    );

    // While the check-in reminder banner shows, it is the single check-in entry
    // point — the header button hides to avoid duplicate affordances.
    const checkInBannerVisible = isCheckInBannerVisible(checkInRemindersEnabled, lastReconciled, currentYearMonth);

    // Filter projection based on horizon
    const filteredProjection = useMemo(() => {
        const now = new Date();
        let endDate: Date;

        switch (horizon) {
            case '6m':
                endDate = new Date(now.getFullYear(), now.getMonth() + 6, 1);
                break;
            case '1y':
                endDate = new Date(now.getFullYear() + 1, now.getMonth(), 1);
                break;
            case '3y':
                endDate = new Date(now.getFullYear() + 3, now.getMonth(), 1);
                break;
            case '5y':
                endDate = new Date(now.getFullYear() + 5, now.getMonth(), 1);
                break;
            default:
                endDate = new Date(now.getFullYear() + 1, now.getMonth(), 1);
        }

        const endYearMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
        return projection.filter(p => p.yearMonth <= endYearMonth);
    }, [projection, horizon]);

    // Calculate KPI values
    const kpiValues = useMemo(() => {
        const endMonth = filteredProjection[filteredProjection.length - 1];

        // Prefer the latest real balance (bank sync / reconciliation) over the
        // manually-entered starting value, so the bank value is the source of truth.
        const cashTotal = accounts.reduce((sum, a) => sum + (cashCurrentBalances.get(a.id) ?? a.startingBalance), 0);
        // `??`, not `||`: an investment reconciled to exactly 0 is worth 0.
        const investmentsTotal = investments.reduce((sum, i) => sum + (i.currentValuation ?? i.startingValuation), 0);
        const receivablesTotal = receivables.reduce((sum, r) => sum + r.currentBalance, 0);
        const debtsTotal = debts.reduce((sum, d) => sum + d.initialPrincipal, 0);

        // Member's home equity (stake − loan-share liability) adds to net worth.
        const mortgageEquity = mortgageSummary?.equity ?? 0;
        const mortgageLiability = mortgageSummary?.liability ?? 0;

        // Linked credit-card outstanding is a real liability (read live from the bank).
        // Split balance (Splitwise replacement) adds when owed, subtracts when owing.
        const netWorth = cashTotal + investmentsTotal + receivablesTotal - debtsTotal - cardLiabilitiesTotal + mortgageEquity + splitNetTotal;
        const projectedNetWorth = endMonth?.netWorth ?? netWorth;

        const liquidAssets = cashTotal + investmentsTotal;

        return {
            netWorth,
            // undefined (badge hidden) when there is no previous-month row to compare with.
            netWorthChange: netWorthChangeVsLastMonth(projection, currentYearMonth, netWorth),
            projectedNetWorth,
            cashTotal,
            investmentsTotal,
            liquidAssets,
            receivablesTotal,
            debtsTotal,
            cardLiabilitiesTotal,
            splitNetTotal,
            mortgageEquity,
            mortgageLiability,
        };
    }, [accounts, investments, receivables, debts, projection, currentYearMonth, filteredProjection, mortgageSummary, cardLiabilitiesTotal, splitNetTotal, cashCurrentBalances]);

    // Hero card: this month's real cash numbers from the per-account forecasts
    // (the wealth projection starts at the current month, so it has no
    // previous month to compare against — see src/lib/overview-hero.ts).
    const heroSummary = useMemo(() => {
        if (!wealth) return null;
        return deriveHeroSummary({
            accountIds: wealth.accounts.map((a) => a.id),
            cashProjections: wealth.cashProjections,
            currentYearMonth,
            wealthCurrentMonth: projection.find((p) => p.yearMonth === currentYearMonth),
        });
    }, [wealth, projection, currentYearMonth]);

    // Utilization ratio for the credit-card KPI's progress bar; drives its
    // color (green/yellow/red) independently of the tile's own `severity`.
    const cardUtilization = cardCredit ? (cardCredit.limit - cardCredit.available) / cardCredit.limit : null;

    if (isLoading) {
        return <KpiGridSkeleton />;
    }

    const errorBanner = loadError && (
        <AlertBanner
            severity="error"
            icon={<MdErrorOutline />}
            action={{ label: retrying ? 'Retrying…' : 'Retry', onClick: handleRetry }}
        >
            {snapshot
                ? <>{loadError} Showing the balances from the last successful load.</>
                : loadError}
        </AlertBanner>
    );

    // First load failed: never show totals computed from missing data.
    if (!snapshot) {
        return (
            <div className="space-y-4 lg:space-y-6 max-w-360 mx-auto py-4 lg:py-8">
                <h1 className={`text-3xl sm:text-4xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    Overview
                </h1>
                {errorBanner || (
                    <AlertBanner severity="error" icon={<MdErrorOutline />} action={{ label: 'Retry', onClick: handleRetry }}>
                        Couldn&apos;t load the overview. Try again.
                    </AlertBanner>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4 lg:space-y-6 max-w-360 mx-auto py-4 lg:py-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className={`text-3xl sm:text-4xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        Overview
                    </h1>
                    {lastReconciled && (
                        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Last check-in: {formatYearMonth(lastReconciled)}
                        </p>
                    )}
                </div>
                {/* Hidden while the reminder banner shows — the banner is the
                    single entry point then (no duplicate affordances). */}
                {!checkInBannerVisible && (
                    <Button
                        label="Monthly check-in"
                        icon={<MdSync />}
                        severity="success"
                        className="shrink-0 self-start sm:self-auto"
                        onClick={() => appContext?.openReconcile()}
                    />
                )}
            </div>

            {errorBanner}

            <BannerStack
                checkInRemindersEnabled={checkInRemindersEnabled}
                lastReconciled={lastReconciled}
                currentYearMonth={currentYearMonth}
                onStartCheckIn={() => appContext?.openReconcile()}
                euriborDue={euriborDue}
                onUpdateEuribor={() => router.push('/mortgage')}
                bankAttention={bankAttention}
                onReconnectBank={() => router.push('/settings?tab=banking')}
                budgetBanner={budgetBanner}
                onOpenBudget={(id) => router.push(`/budgets/${id}`)}
            />

            {/* Hero Card */}
            <StatusHeroCard
                userName={session?.user?.name || 'there'}
                summary={heroSummary}
                currency={displayCurrency}
            />

            {/* KPI tiles, grouped Net / Assets / Debts & liabilities. Simple mode
                shows just Net Worth + Cash with a "See all" expander. */}
            {isSimple && !showAllKpis && (
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <KpiTile
                            title={plainTerm('netWorth', isSimple)}
                            help={helpText('netWorth')}
                            value={kpiValues.netWorth}
                            currency={displayCurrency}
                            change={kpiValues.netWorthChange}
                            changeLabel="vs last month"
                            icon={<MdShowChart />}
                            severity="info"
                            onClick={() => setExplainNetWorthVisible(true)}
                        />
                        <KpiTile
                            title="Cash"
                            value={kpiValues.cashTotal}
                            currency={displayCurrency}
                            icon={<MdAccountBalanceWallet />}
                            severity="success"
                            onClick={() => setEntityDrawer({ visible: true, category: 'cash' })}
                        />
                    </div>
                    <div className="text-center">
                        <Button label="See all balances" text size="small" severity="secondary" onClick={() => setShowAllKpis(true)} />
                    </div>
                </div>
            )}
            {(!isSimple || showAllKpis) && (
                <div className={`space-y-4 ${isSimple ? 'animate-fade-in' : ''}`}>
                    <KpiGroup title="Net">
                        <KpiTile
                            title={plainTerm('netWorth', isSimple)}
                            help={helpText('netWorth')}
                            value={kpiValues.netWorth}
                            currency={displayCurrency}
                            change={kpiValues.netWorthChange}
                            changeLabel="vs last month"
                            icon={<MdShowChart />}
                            severity="info"
                            onClick={() => setExplainNetWorthVisible(true)}
                        />
                        <KpiTile
                            title={plainTerm('liquidAssets', isSimple)}
                            help={helpText('liquidAssets')}
                            value={kpiValues.liquidAssets}
                            currency={displayCurrency}
                            icon={<MdEuro />}
                            severity="info"
                        />
                    </KpiGroup>
                    <KpiGroup title="Assets">
                        <KpiTile
                            title="Cash"
                            value={kpiValues.cashTotal}
                            currency={displayCurrency}
                            icon={<MdAccountBalanceWallet />}
                            severity="success"
                            onClick={() => setEntityDrawer({ visible: true, category: 'cash' })}
                        />
                        <KpiTile
                            title="Investments"
                            value={kpiValues.investmentsTotal}
                            currency={displayCurrency}
                            icon={<MdBarChart />}
                            severity="success"
                            onClick={() => setEntityDrawer({ visible: true, category: 'investments' })}
                        />
                        <KpiTile
                            title={plainTerm('receivables', isSimple)}
                            help={helpText('receivables')}
                            value={kpiValues.receivablesTotal}
                            currency={displayCurrency}
                            icon={<MdGroup />}
                            severity="warning"
                            onClick={() => setEntityDrawer({ visible: true, category: 'receivables' })}
                        />
                        {mortgageSummary && (
                            <KpiTile
                                title={plainTerm('homeEquity', isSimple)}
                                help={helpText('homeEquity')}
                                value={kpiValues.mortgageEquity}
                                currency={displayCurrency}
                                icon={<MdHouse />}
                                severity="success"
                                onClick={() => router.push('/mortgage')}
                            />
                        )}
                        {kpiValues.splitNetTotal > 0 && (
                            <KpiTile
                                title="Split balance"
                                help={helpText('splitBalance')}
                                value={kpiValues.splitNetTotal}
                                currency={displayCurrency}
                                icon={<MdGroup />}
                                severity="warning"
                                onClick={() => router.push('/split')}
                            />
                        )}
                    </KpiGroup>
                    <KpiGroup title="Debts & liabilities">
                        <KpiTile
                            title="Debts"
                            value={-kpiValues.debtsTotal}
                            currency={displayCurrency}
                            icon={<MdCreditCard />}
                            severity="danger"
                            onClick={() => setEntityDrawer({ visible: true, category: 'debts' })}
                        />
                        {kpiValues.cardLiabilitiesTotal > 0 && (
                            <KpiTile
                                title={plainTerm('creditCards', isSimple)}
                                help={helpText('creditCards')}
                                value={-kpiValues.cardLiabilitiesTotal}
                                currency={displayCurrency}
                                subline={cardCredit
                                    ? `${formatCurrency(cardCredit.available, displayCurrency)} available of ${formatCurrency(cardCredit.limit, displayCurrency)} limit`
                                    : undefined}
                                progress={cardUtilization ?? undefined}
                                progressSeverity={cardUtilization === null ? undefined : cardUtilization >= 0.8 ? 'danger' : cardUtilization >= 0.5 ? 'warning' : 'success'}
                                icon={<MdCreditCard />}
                                severity="danger"
                                onClick={() => router.push('/bank')}
                            />
                        )}
                        {mortgageSummary && (
                            <KpiTile
                                title="Mortgage (your share)"
                                value={-kpiValues.mortgageLiability}
                                currency={displayCurrency}
                                icon={<MdHomeWork />}
                                severity="danger"
                                onClick={() => router.push('/mortgage')}
                            />
                        )}
                        {kpiValues.splitNetTotal < 0 && (
                            <KpiTile
                                title="Split balance"
                                value={kpiValues.splitNetTotal}
                                currency={displayCurrency}
                                icon={<MdGroup />}
                                severity="danger"
                                onClick={() => router.push('/split')}
                            />
                        )}
                    </KpiGroup>
                </div>
            )}

            {/* Where the wealth currently sits — shown in BOTH display modes
                (deliberately outside the chart grid, which Simple mode hides). */}
            <WealthDistribution
                values={kpiValues}
                currency={displayCurrency}
                isMixedCurrency={isMixedCurrency}
                isSimple={isSimple}
            />

            {/* Main Chart Section */}
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 ${isSimple ? 'hidden' : ''}`}>
                {/* Net Worth Chart */}
                <div className="lg:col-span-2">
                    <Card>
                        <div className="flex flex-col gap-3 mb-4">
                            <div className="flex items-center justify-between gap-2">
                                <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                    Net Worth Projection
                                </h2>
                                <Button
                                    icon={showBreakdown ? <MdShowChart /> : <MdBarChart />}
                                    text
                                    severity="secondary"
                                    tooltip={showBreakdown ? 'Show net worth only' : 'Show breakdown'}
                                    onClick={() => setShowBreakdown(!showBreakdown)}
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <SelectButton
                                    value={horizon}
                                    options={HORIZON_OPTIONS}
                                    onChange={(e) => e.value && setHorizon(e.value)}
                                    className="text-sm"
                                />
                                <SelectButton
                                    value={wealthScope}
                                    options={SCOPE_OPTIONS}
                                    onChange={(e) => e.value && setWealthScope(e.value)}
                                    className="text-sm"
                                />
                            </div>
                        </div>

                        {showBreakdown ? (
                            <WealthChart data={filteredProjection} currency={displayCurrency} scope={wealthScope} />
                        ) : (
                            <NetWorthChart data={filteredProjection} currency={displayCurrency} scope={wealthScope} />
                        )}
                    </Card>
                </div>

                {/* Plan-vs-reality feedback loop */}
                <div className="space-y-6">
                    {planCheck && (
                        <PlanCheckCard
                            monthly={planCheck.monthly}
                            retrospective={planCheck.retrospective}
                            currency={displayCurrency}
                        />
                    )}
                    <Button
                        label="View month details"
                        icon={<MdArrowForward />}
                        iconPos="right"
                        text
                        className="w-full"
                        onClick={() => router.push('/cashflow')}
                    />
                </div>
            </div>

            {/* Projected Net Worth at Horizon */}
            <Card className={isSimple ? 'hidden' : ''}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            Projected Net Worth
                        </h2>
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            At end of selected horizon ({horizon.toUpperCase()})
                        </p>
                    </div>
                    <div className="text-right">
                        <p className={`text-3xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            {formatCurrency(kpiValues.projectedNetWorth, displayCurrency)}
                            {isMixedCurrency && <span className={`text-sm font-normal ml-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>(mixed currencies)</span>}
                        </p>
                        <Tag
                            value={`${kpiValues.projectedNetWorth >= kpiValues.netWorth ? '+' : ''}${formatCurrency(kpiValues.projectedNetWorth - kpiValues.netWorth, displayCurrency)}`}
                            severity={kpiValues.projectedNetWorth >= kpiValues.netWorth ? 'success' : 'danger'}
                        />
                    </div>
                </div>
            </Card>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Button
                    label="Add Income"
                    icon={<MdAddCircle />}
                    severity="success"
                    outlined
                    className="justify-center"
                    onClick={() => appContext?.openDrawer({ mode: 'create', entityType: 'income' })}
                />
                <Button
                    label="Add Expense"
                    icon={<MdRemoveCircle />}
                    severity="danger"
                    outlined
                    className="justify-center"
                    onClick={() => appContext?.openDrawer({ mode: 'create', entityType: 'expense' })}
                />
                <Button
                    label="Add Receivable"
                    icon={<MdGroup />}
                    severity="warning"
                    outlined
                    className="justify-center"
                    onClick={() => appContext?.openDrawer({ mode: 'create', entityType: 'receivable' })}
                />
                <Button
                    label="Add Debt"
                    icon={<MdCreditCard />}
                    severity="danger"
                    outlined
                    className="justify-center"
                    onClick={() => appContext?.openDrawer({ mode: 'create', entityType: 'debt' })}
                />
            </div>

            {entityDrawerMounted && (
            <EntityListDrawer
                visible={entityDrawer.visible}
                category={entityDrawer.category}
                onClose={() => setEntityDrawer(prev => ({ ...prev, visible: false }))}
                // Through AppLayout so its shared account list (Cashflow's
                // source) refreshes too; it then calls fetchData.
                onRefresh={appContext ? appContext.refreshData : fetchData}
            />
            )}

            <NetWorthExplainDialog
                visible={explainNetWorthVisible}
                onHide={() => setExplainNetWorthVisible(false)}
                values={kpiValues}
                currency={displayCurrency}
            />
        </div>
    );
}
