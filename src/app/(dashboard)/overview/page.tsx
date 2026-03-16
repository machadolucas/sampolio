'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { SelectButton } from 'primereact/selectbutton';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Tag } from 'primereact/tag';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import { getAccounts } from '@/lib/actions/accounts';
import { getInvestmentAccounts, getContributions } from '@/lib/actions/investments';
import { getReceivables, getRepayments } from '@/lib/actions/receivables';
import { getDebts, getReferenceRates, getExtraPayments } from '@/lib/actions/debts';
import { getProjection } from '@/lib/actions/projection';
import { getLatestCompletedSession } from '@/lib/actions/reconciliation';
import { calculateWealthProjection, getLatestEndDate } from '@/lib/wealth-projection';
import type { FinancialAccount, InvestmentAccount, Receivable, Debt, TimeHorizon, WealthProjectionMonth, Currency, InvestmentContribution, ReceivableRepayment, DebtReferenceRate, DebtExtraPayment, MonthlyProjection } from '@/types';
import { NetWorthChart, WealthChart } from '@/components/charts';
import { EntityListDrawer } from '@/components/ui/entity-list-drawer';
import { StatusHeroCard } from '@/components/ui/status-hero-card';
import { MdInfo, MdSync, MdShowChart, MdAttachMoney, MdAccountBalanceWallet, MdBarChart, MdGroup, MdCreditCard, MdArrowForward, MdAddCircle, MdRemoveCircle } from 'react-icons/md';

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

interface KPICardProps {
    title: string;
    value: number;
    currency?: Currency;
    change?: number;
    changeLabel?: string;
    icon: React.ReactNode;
    onClick?: () => void;
    severity?: 'info' | 'success' | 'warning' | 'danger';
}

function KPICard({ title, value, currency = 'EUR', change, changeLabel, icon, onClick, severity = 'info' }: KPICardProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const severityColors = {
        info: isDark ? 'text-blue-400' : 'text-blue-600',
        success: isDark ? 'text-green-400' : 'text-green-600',
        warning: isDark ? 'text-yellow-400' : 'text-yellow-600',
        danger: isDark ? 'text-red-400' : 'text-red-600',
    };

    return (
        <Card
            className={`cursor-pointer transition-transform hover:scale-[1.02] ${onClick ? 'hover:shadow-lg' : ''}`}
            onClick={onClick}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {title}
                    </p>
                    <p className={`text-2xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {formatCurrency(value, currency)}
                    </p>
                    {change !== undefined && (
                        <div className="flex items-center gap-2 mt-2">
                            <Tag
                                value={`${change >= 0 ? '+' : ''}${formatCurrency(change, currency)}`}
                                severity={change >= 0 ? 'success' : 'danger'}
                            />
                            {changeLabel && (
                                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {changeLabel}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div className={`p-3 rounded-full ${isDark ? 'bg-gray-800' : 'bg-gray-100'} text-xl ${severityColors[severity]}`}>
                    {icon}
                </div>
            </div>
        </Card>
    );
}

interface ImpactItem {
    name: string;
    amount: number;
    type: 'income' | 'expense' | 'valuation';
    entityType?: string;
    entityId?: string;
}

function ImpactPanel({ items, currency = 'EUR' as Currency }: { items: ImpactItem[]; currency?: Currency }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const sortedItems = [...items].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5);

    if (sortedItems.length === 0) {
        return (
            <div className={`text-center py-6 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <MdInfo size={24} className="mb-2" />
                <p>No significant changes this month</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {sortedItems.map((item, index) => (
                <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'
                        }`}
                >
                    <div className="flex items-center gap-3">
                        <i className={`pi ${item.type === 'income' ? 'pi-arrow-up text-green-500' :
                            item.type === 'expense' ? 'pi-arrow-down text-red-500' :
                                'pi-chart-line text-blue-500'
                            }`} />
                        <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>
                            {item.name}
                        </span>
                    </div>
                    <span className={`font-medium ${item.amount >= 0 ? 'text-green-500' : 'text-red-500'
                        }`}>
                        {item.amount >= 0 ? '+' : ''}{formatCurrency(item.amount, currency)}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default function OverviewPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const appContext = useAppContext();
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [isLoading, setIsLoading] = useState(true);
    const [horizon, setHorizon] = useState<TimeHorizon>('1y');
    const [showBreakdown, setShowBreakdown] = useState(true);
    const [entityDrawer, setEntityDrawer] = useState<{ visible: boolean; category: EntityCategory }>({ visible: false, category: 'cash' });
    const displayMode = appContext?.displayMode ?? 'advanced';
    const isSimple = displayMode === 'simple';

    // Data states
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [investments, setInvestments] = useState<InvestmentAccount[]>([]);
    const [receivables, setReceivables] = useState<Receivable[]>([]);
    const [debts, setDebts] = useState<Debt[]>([]);
    const [projection, setProjection] = useState<WealthProjectionMonth[]>([]);
    const [lastReconciled, setLastReconciled] = useState<string | null>(null);

    const displayCurrency = useMemo(() => getPrimaryCurrency(accounts), [accounts]);
    const isMixedCurrency = useMemo(() => hasMixedCurrencies(accounts), [accounts]);

    const hasLoadedOnce = useRef(false);

    const fetchData = useCallback(async () => {
        if (!hasLoadedOnce.current) {
            setIsLoading(true);
        }
        try {
            const [accountsRes, investmentsRes, receivablesRes, debtsRes, sessionRes] = await Promise.all([
                getAccounts(),
                getInvestmentAccounts(),
                getReceivables(),
                getDebts(),
                getLatestCompletedSession(),
            ]);

            const activeAccounts = accountsRes.success && accountsRes.data
                ? accountsRes.data.filter((a: FinancialAccount) => !a.isArchived)
                : [];
            const activeInvestments = investmentsRes.success && investmentsRes.data
                ? investmentsRes.data.filter((i: InvestmentAccount) => !i.isArchived)
                : [];
            const activeReceivables = receivablesRes.success && receivablesRes.data
                ? receivablesRes.data.filter((r: Receivable) => !r.isArchived)
                : [];
            const activeDebts = debtsRes.success && debtsRes.data
                ? debtsRes.data.filter((d: Debt) => !d.isArchived)
                : [];

            setAccounts(activeAccounts);
            setInvestments(activeInvestments);
            setReceivables(activeReceivables);
            setDebts(activeDebts);

            if (sessionRes.success && sessionRes.data) {
                setLastReconciled(sessionRes.data.yearMonth);
            }

            // Fetch sub-data for wealth projection in parallel
            const [contributionsResults, repaymentsResults, ratesResults, extraPaymentsResults, cashProjectionsResults] = await Promise.all([
                Promise.all(activeInvestments.map((inv: InvestmentAccount) => getContributions(inv.id).then(r => [inv.id, r.success && r.data ? r.data : []] as [string, InvestmentContribution[]]))),
                Promise.all(activeReceivables.map((rec: Receivable) => getRepayments(rec.id).then(r => [rec.id, r.success && r.data ? r.data : []] as [string, ReceivableRepayment[]]))),
                Promise.all(activeDebts.map((d: Debt) => getReferenceRates(d.id).then(r => [d.id, r.success && r.data ? r.data : []] as [string, DebtReferenceRate[]]))),
                Promise.all(activeDebts.map((d: Debt) => getExtraPayments(d.id).then(r => [d.id, r.success && r.data ? r.data : []] as [string, DebtExtraPayment[]]))),
                Promise.all(activeAccounts.map((a: FinancialAccount) => getProjection(a.id).then(r => [a.id, r.success && r.data ? r.data.monthly : []] as [string, MonthlyProjection[]]))),
            ]);

            const investmentContributions = new Map<string, InvestmentContribution[]>(contributionsResults);
            const receivableRepayments = new Map<string, ReceivableRepayment[]>(repaymentsResults);
            const debtReferenceRates = new Map<string, DebtReferenceRate[]>(ratesResults);
            const debtExtraPayments = new Map<string, DebtExtraPayment[]>(extraPaymentsResults);
            const cashProjections = new Map<string, MonthlyProjection[]>(cashProjectionsResults);

            const wealthData = {
                cashAccounts: activeAccounts,
                cashProjections,
                investments: activeInvestments,
                investmentContributions,
                receivables: activeReceivables,
                receivableRepayments,
                debts: activeDebts,
                debtReferenceRates,
                debtExtraPayments,
            };

            const now = new Date();
            const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const endDate = getLatestEndDate(wealthData, 60);

            const projectionMonths = calculateWealthProjection(wealthData, startDate, endDate);
            setProjection(projectionMonths);
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            if (!hasLoadedOnce.current) {
                hasLoadedOnce.current = true;
                setIsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Register refresh callback
    useEffect(() => {
        if (appContext) {
            appContext.setRefreshCallback(fetchData);
        }
    }, [appContext, fetchData]);

    // Current month
    const currentYearMonth = useMemo(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }, []);

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
        const prevMonth = projection.find(p => {
            const [year, month] = currentYearMonth.split('-').map(Number);
            const prevDate = new Date(year, month - 2, 1);
            return p.yearMonth === `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        });
        const endMonth = filteredProjection[filteredProjection.length - 1];

        const cashTotal = accounts.reduce((sum, a) => sum + a.startingBalance, 0);
        const investmentsTotal = investments.reduce((sum, i) => sum + (i.currentValuation || i.startingValuation), 0);
        const receivablesTotal = receivables.reduce((sum, r) => sum + r.currentBalance, 0);
        const debtsTotal = debts.reduce((sum, d) => sum + d.initialPrincipal, 0);

        const netWorth = cashTotal + investmentsTotal + receivablesTotal - debtsTotal;
        const prevNetWorth = prevMonth?.netWorth || netWorth;
        const projectedNetWorth = endMonth?.netWorth || netWorth;

        const liquidAssets = cashTotal + investmentsTotal;

        return {
            netWorth,
            netWorthChange: netWorth - prevNetWorth,
            projectedNetWorth,
            cashTotal,
            investmentsTotal,
            liquidAssets,
            receivablesTotal,
            debtsTotal,
        };
    }, [accounts, investments, receivables, debts, projection, currentYearMonth, filteredProjection]);

    // Hero card projections: find current and previous month from the first account's cash projection
    const heroProjections = useMemo(() => {
        if (projection.length === 0) return { current: undefined, previous: undefined };
        // Use the wealth projection's cash totals to approximate per-month data
        const currentMonth = projection.find(p => p.yearMonth === currentYearMonth);
        const prevMonthDate = new Date();
        prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
        const prevYM = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
        const prevMonth = projection.find(p => p.yearMonth === prevYM);
        return { current: currentMonth, previous: prevMonth };
    }, [projection, currentYearMonth]);

    // Mock impact items (in real app, calculate from projection changes)
    const impactItems: ImpactItem[] = useMemo(() => {
        const items: ImpactItem[] = [];

        // Add top income sources
        accounts.forEach(a => {
            if (a.startingBalance > 0) {
                items.push({
                    name: `${a.name} balance`,
                    amount: a.startingBalance,
                    type: 'income',
                    entityType: 'cash-account',
                    entityId: a.id,
                });
            }
        });

        return items.slice(0, 5);
    }, [accounts]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-360 mx-auto py-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className={`text-4xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        Overview
                    </h1>
                    {lastReconciled && (
                        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Last reconciled: {formatYearMonth(lastReconciled)}
                        </p>
                    )}
                </div>
                <Button
                    label="Monthly check-in"
                    icon={<MdSync />}
                    severity="success"
                    onClick={() => appContext?.openReconcile()}
                />
            </div>

            {/* Stale reconciliation banner */}
            {(() => {
                if (!lastReconciled) return (
                    <div className={`flex items-center gap-3 p-4 rounded-lg border ${isDark ? 'bg-yellow-900/20 border-yellow-800 text-yellow-400' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>
                        <MdSync size={20} />
                        <span>You haven&apos;t done a check-in yet. Verify your balances to keep projections accurate.</span>
                        <Button label="Start check-in" size="small" severity="warning" className="ml-auto" onClick={() => appContext?.openReconcile()} />
                    </div>
                );
                const lastDate = new Date(lastReconciled + '-15');
                const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
                if (daysSince > 30) return (
                    <div className={`flex items-center gap-3 p-4 rounded-lg border ${isDark ? 'bg-yellow-900/20 border-yellow-800 text-yellow-400' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>
                        <MdSync size={20} />
                        <span>It&apos;s been over a month since your last check-in ({formatYearMonth(lastReconciled)}). Time for a quick review?</span>
                        <Button label="Start check-in" size="small" severity="warning" className="ml-auto" onClick={() => appContext?.openReconcile()} />
                    </div>
                );
                return null;
            })()}

            {/* Hero Card */}
            <StatusHeroCard
                userName={session?.user?.name || 'there'}
                currentMonthProjection={heroProjections.current ? {
                    yearMonth: currentYearMonth,
                    year: parseInt(currentYearMonth.split('-')[0]),
                    month: parseInt(currentYearMonth.split('-')[1]),
                    startingBalance: heroProjections.current.cashAccountsTotal,
                    totalIncome: 0,
                    totalExpenses: 0,
                    netChange: heroProjections.current.netWorth - (heroProjections.previous?.netWorth ?? heroProjections.current.netWorth),
                    endingBalance: heroProjections.current.cashAccountsTotal,
                    incomeBreakdown: [],
                    expenseBreakdown: [],
                } : undefined}
                previousMonthProjection={heroProjections.previous ? {
                    yearMonth: '',
                    year: 0,
                    month: 0,
                    startingBalance: 0,
                    totalIncome: 0,
                    totalExpenses: 0,
                    netChange: 0,
                    endingBalance: heroProjections.previous.cashAccountsTotal,
                    incomeBreakdown: [],
                    expenseBreakdown: [],
                } : undefined}
                currency={displayCurrency}
            />

            {/* KPI Cards */}
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${isSimple ? 'hidden' : ''}`}>
                <KPICard
                    title="Net Worth"
                    value={kpiValues.netWorth}
                    currency={displayCurrency}
                    change={kpiValues.netWorthChange}
                    changeLabel="vs last month"
                    icon={<MdShowChart />}
                    severity="info"
                />
                <KPICard
                    title="Liquid Assets"
                    value={kpiValues.liquidAssets}
                    currency={displayCurrency}
                    icon={<MdAttachMoney />}
                    severity="info"
                />
                <KPICard
                    title="Cash"
                    value={kpiValues.cashTotal}
                    currency={displayCurrency}
                    icon={<MdAccountBalanceWallet />}
                    severity="success"
                    onClick={() => setEntityDrawer({ visible: true, category: 'cash' })}
                />
                <KPICard
                    title="Investments"
                    value={kpiValues.investmentsTotal}
                    currency={displayCurrency}
                    icon={<MdBarChart />}
                    severity="success"
                    onClick={() => setEntityDrawer({ visible: true, category: 'investments' })}
                />
                <KPICard
                    title="Receivables"
                    value={kpiValues.receivablesTotal}
                    currency={displayCurrency}
                    icon={<MdGroup />}
                    severity="warning"
                    onClick={() => setEntityDrawer({ visible: true, category: 'receivables' })}
                />
                <KPICard
                    title="Debts"
                    value={-kpiValues.debtsTotal}
                    currency={displayCurrency}
                    icon={<MdCreditCard />}
                    severity="danger"
                    onClick={() => setEntityDrawer({ visible: true, category: 'debts' })}
                />
            </div>

            {/* Main Chart Section */}
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 ${isSimple ? 'hidden' : ''}`}>
                {/* Net Worth Chart */}
                <div className="lg:col-span-2">
                    <Card>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                Net Worth Projection
                            </h2>
                            <div className="flex items-center gap-3">
                                <SelectButton
                                    value={horizon}
                                    options={HORIZON_OPTIONS}
                                    onChange={(e) => setHorizon(e.value)}
                                    className="text-sm"
                                />
                                <Button
                                    icon={showBreakdown ? <MdShowChart /> : <MdBarChart />}
                                    text
                                    severity="secondary"
                                    tooltip={showBreakdown ? 'Show net worth only' : 'Show breakdown'}
                                    onClick={() => setShowBreakdown(!showBreakdown)}
                                />
                            </div>
                        </div>

                        {showBreakdown ? (
                            <WealthChart data={filteredProjection} currency={displayCurrency} />
                        ) : (
                            <NetWorthChart data={filteredProjection} currency={displayCurrency} />
                        )}

                        <div className="flex justify-center gap-6 mt-4 text-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-blue-500" />
                                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Net Worth</span>
                            </div>
                            {showBreakdown && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-green-500" />
                                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cash</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-purple-500" />
                                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Investments</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-red-500" />
                                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Debts</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>
                </div>

                {/* This Month Impact */}
                <div>
                    <Card>
                        <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            This Month Impact
                        </h2>
                        <ImpactPanel items={impactItems} currency={displayCurrency} />

                        <div className="mt-4 pt-4 border-t border-gray-700">
                            <Button
                                label="View Month Details"
                                icon={<MdArrowForward />}
                                iconPos="right"
                                text
                                className="w-full"
                                onClick={() => router.push('/cashflow')}
                            />
                        </div>
                    </Card>
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

            <EntityListDrawer
                visible={entityDrawer.visible}
                category={entityDrawer.category}
                onClose={() => setEntityDrawer(prev => ({ ...prev, visible: false }))}
                onRefresh={fetchData}
            />
        </div>
    );
}
