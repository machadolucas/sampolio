'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from 'primereact/card';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressSpinner } from 'primereact/progressspinner';
import { TabView, TabPanel } from 'primereact/tabview';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import { useDashboardContext } from '@/components/layout/dashboard-layout';
import { WealthChart, NetWorthChart } from '@/components/charts';
import { getAccounts } from '@/lib/actions/accounts';
import { getProjection } from '@/lib/actions/projection';
import { getInvestmentAccounts, getContributions } from '@/lib/actions/investments';
import { getReceivables, getRepayments } from '@/lib/actions/receivables';
import { getDebts, getReferenceRates, getExtraPayments } from '@/lib/actions/debts';
import {
    calculateWealthProjection,
    getEarliestStartDate,
    getLatestEndDate,
    type WealthProjectionData,
} from '@/lib/wealth-projection';
import type {
    FinancialAccount,
    InvestmentAccount,
    InvestmentContribution,
    Receivable,
    ReceivableRepayment,
    Debt,
    DebtReferenceRate,
    DebtExtraPayment,
    WealthProjectionMonth,
    MonthlyProjection,
    Currency,
} from '@/types';

export default function WealthPage() {
    const dashboardContext = useDashboardContext();
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [cashProjections, setCashProjections] = useState<Map<string, MonthlyProjection[]>>(new Map());
    const [investments, setInvestments] = useState<InvestmentAccount[]>([]);
    const [investmentContributions, setInvestmentContributions] = useState<Map<string, InvestmentContribution[]>>(new Map());
    const [receivables, setReceivables] = useState<Receivable[]>([]);
    const [receivableRepayments, setReceivableRepayments] = useState<Map<string, ReceivableRepayment[]>>(new Map());
    const [debts, setDebts] = useState<Debt[]>([]);
    const [debtReferenceRates, setDebtReferenceRates] = useState<Map<string, DebtReferenceRate[]>>(new Map());
    const [debtExtraPayments, setDebtExtraPayments] = useState<Map<string, DebtExtraPayment[]>>(new Map());

    const [wealthProjection, setWealthProjection] = useState<WealthProjectionMonth[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTabIndex, setActiveTabIndex] = useState(0);

    // Default to EUR for display (multi-currency aggregation would need conversion)
    const displayCurrency: Currency = 'EUR';

    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);

            // Fetch cash accounts and their projections
            const accountsResult = await getAccounts();
            if (accountsResult.success && accountsResult.data) {
                const activeAccounts = accountsResult.data.filter((a: FinancialAccount) => !a.isArchived);
                setAccounts(activeAccounts);

                // Fetch projections for each account
                const projMap = new Map<string, MonthlyProjection[]>();
                for (const account of activeAccounts) {
                    const projResult = await getProjection(account.id);
                    if (projResult.success && projResult.data?.monthly) {
                        projMap.set(account.id, projResult.data.monthly);
                    }
                }
                setCashProjections(projMap);
            }

            // Fetch investments
            const investResult = await getInvestmentAccounts();
            if (investResult.success && investResult.data) {
                const activeInvestments = investResult.data.filter((i: InvestmentAccount) => !i.isArchived);
                setInvestments(activeInvestments);

                const contribMap = new Map<string, InvestmentContribution[]>();
                for (const inv of activeInvestments) {
                    const contribResult = await getContributions(inv.id);
                    if (contribResult.success && contribResult.data) {
                        contribMap.set(inv.id, contribResult.data);
                    }
                }
                setInvestmentContributions(contribMap);
            }

            // Fetch receivables
            const recResult = await getReceivables();
            if (recResult.success && recResult.data) {
                const activeReceivables = recResult.data.filter((r: Receivable) => !r.isArchived);
                setReceivables(activeReceivables);

                const repayMap = new Map<string, ReceivableRepayment[]>();
                for (const rec of activeReceivables) {
                    const repayResult = await getRepayments(rec.id);
                    if (repayResult.success && repayResult.data) {
                        repayMap.set(rec.id, repayResult.data);
                    }
                }
                setReceivableRepayments(repayMap);
            }

            // Fetch debts
            const debtResult = await getDebts();
            if (debtResult.success && debtResult.data) {
                const activeDebts = debtResult.data.filter((d: Debt) => !d.isArchived);
                setDebts(activeDebts);

                const ratesMap = new Map<string, DebtReferenceRate[]>();
                const extrasMap = new Map<string, DebtExtraPayment[]>();
                for (const debt of activeDebts) {
                    const ratesResult = await getReferenceRates(debt.id);
                    if (ratesResult.success && ratesResult.data) {
                        ratesMap.set(debt.id, ratesResult.data);
                    }
                    const extrasResult = await getExtraPayments(debt.id);
                    if (extrasResult.success && extrasResult.data) {
                        extrasMap.set(debt.id, extrasResult.data);
                    }
                }
                setDebtReferenceRates(ratesMap);
                setDebtExtraPayments(extrasMap);
            }
        } catch (err) {
            console.error('Failed to fetch wealth data:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Register refresh callback
    useEffect(() => {
        if (dashboardContext) {
            dashboardContext.setRefreshCallback(fetchData);
        }
    }, [dashboardContext, fetchData]);

    // Calculate wealth projection when data changes
    useEffect(() => {
        if (isLoading) return;

        const data: WealthProjectionData = {
            cashAccounts: accounts,
            cashProjections,
            investments,
            investmentContributions,
            receivables,
            receivableRepayments,
            debts,
            debtReferenceRates,
            debtExtraPayments,
        };

        const startDate = getEarliestStartDate(data);
        const endDate = getLatestEndDate(data);
        const projection = calculateWealthProjection(data, startDate, endDate);
        setWealthProjection(projection);
    }, [
        isLoading,
        accounts,
        cashProjections,
        investments,
        investmentContributions,
        receivables,
        receivableRepayments,
        debts,
        debtReferenceRates,
        debtExtraPayments,
    ]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            </div>
        );
    }

    const hasAnyData = accounts.length > 0 || investments.length > 0 || receivables.length > 0 || debts.length > 0;

    if (!hasAnyData) {
        return (
            <div className="text-center py-16">
                <i className="pi pi-chart-line text-6xl text-gray-400 mb-4"></i>
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    No wealth data yet
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                    Add financial accounts, investments, receivables, or debts to see your wealth projection.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                    Use the menu to add data.
                </p>
            </div>
        );
    }

    // Calculate summary stats from first and last month
    const firstMonth = wealthProjection[0];
    const lastMonth = wealthProjection[wealthProjection.length - 1];
    const currentNetWorth = firstMonth?.netWorth || 0;
    const projectedNetWorth = lastMonth?.netWorth || 0;
    const netWorthChange = projectedNetWorth - currentNetWorth;
    const netWorthChangePercent = currentNetWorth !== 0 ? (netWorthChange / Math.abs(currentNetWorth)) * 100 : 0;

    // Current breakdown
    const currentCash = firstMonth?.cashAccountsTotal || 0;
    const currentInvestments = firstMonth?.investmentsTotal || 0;
    const currentReceivables = firstMonth?.receivablesTotal || 0;
    const currentDebts = firstMonth?.debtsTotal || 0;
    const totalAssets = currentCash + currentInvestments + currentReceivables;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Wealth Overview</h1>
                <p className="text-gray-600 dark:text-gray-400">
                    Track your net worth, assets, and liabilities over time
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Current Net Worth</p>
                            <p className={`text-2xl font-bold ${currentNetWorth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {formatCurrency(currentNetWorth, displayCurrency)}
                            </p>
                        </div>
                        <div className={`h-12 w-12 rounded-full flex items-center justify-center ${currentNetWorth >= 0 ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'}`}>
                            <i className={`pi pi-dollar text-xl ${currentNetWorth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}></i>
                        </div>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Projected Net Worth</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                {formatCurrency(projectedNetWorth, displayCurrency)}
                            </p>
                            <p className={`text-xs ${netWorthChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {netWorthChange >= 0 ? '+' : ''}{formatCurrency(netWorthChange, displayCurrency)} ({netWorthChangePercent.toFixed(1)}%)
                            </p>
                        </div>
                        <div className={`h-12 w-12 rounded-full flex items-center justify-center ${netWorthChange >= 0 ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'}`}>
                            <i className={`pi ${netWorthChange >= 0 ? 'pi-arrow-up-right text-green-600 dark:text-green-400' : 'pi-arrow-down-right text-red-600 dark:text-red-400'} text-xl`}></i>
                        </div>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Assets</p>
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                {formatCurrency(totalAssets, displayCurrency)}
                            </p>
                        </div>
                        <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                            <i className="pi pi-chart-line text-xl text-blue-600 dark:text-blue-400"></i>
                        </div>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Liabilities</p>
                            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                                {formatCurrency(currentDebts, displayCurrency)}
                            </p>
                        </div>
                        <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                            <i className="pi pi-credit-card text-xl text-red-600 dark:text-red-400"></i>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Asset Breakdown Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="shadow-sm">
                    <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                                <i className="pi pi-wallet text-blue-600 text-sm"></i>
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Cash Accounts</p>
                        </div>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                            {formatCurrency(currentCash, displayCurrency)}
                        </p>
                        <p className="text-xs text-gray-500">{accounts.length} account(s)</p>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                                <i className="pi pi-chart-line text-green-600 text-sm"></i>
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Investments</p>
                        </div>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                            {formatCurrency(currentInvestments, displayCurrency)}
                        </p>
                        <p className="text-xs text-gray-500">{investments.length} account(s)</p>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center">
                                <i className="pi pi-users text-purple-600 text-sm"></i>
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Receivables</p>
                        </div>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                            {formatCurrency(currentReceivables, displayCurrency)}
                        </p>
                        <p className="text-xs text-gray-500">{receivables.length} receivable(s)</p>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                                <i className="pi pi-credit-card text-red-600 text-sm"></i>
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Debts</p>
                        </div>
                        <p className="text-xl font-bold text-red-600 dark:text-red-400">
                            {formatCurrency(currentDebts, displayCurrency)}
                        </p>
                        <p className="text-xs text-gray-500">{debts.length} debt(s)</p>
                    </div>
                </Card>
            </div>

            {/* Charts and Table */}
            <Card className="shadow-sm">
                <TabView activeIndex={activeTabIndex} onTabChange={(e) => setActiveTabIndex(e.index)}>
                    <TabPanel header="Net Worth Chart">
                        <div className="p-4">
                            <NetWorthChart data={wealthProjection} currency={displayCurrency} />
                        </div>
                    </TabPanel>
                    <TabPanel header="Wealth Breakdown">
                        <div className="p-4">
                            <WealthChart data={wealthProjection} currency={displayCurrency} />
                        </div>
                    </TabPanel>
                    <TabPanel header="Monthly Table">
                        <DataTable
                            value={wealthProjection}
                            scrollable
                            scrollHeight="500px"
                            size="small"
                            className="text-sm"
                        >
                            <Column
                                field="yearMonth"
                                header="Month"
                                body={(row: WealthProjectionMonth) => formatYearMonth(row.yearMonth)}
                                frozen
                            />
                            <Column
                                field="cashAccountsTotal"
                                header="Cash"
                                body={(row: WealthProjectionMonth) => formatCurrency(row.cashAccountsTotal, displayCurrency)}
                            />
                            <Column
                                field="investmentsTotal"
                                header="Investments"
                                body={(row: WealthProjectionMonth) => formatCurrency(row.investmentsTotal, displayCurrency)}
                            />
                            <Column
                                field="receivablesTotal"
                                header="Receivables"
                                body={(row: WealthProjectionMonth) => formatCurrency(row.receivablesTotal, displayCurrency)}
                            />
                            <Column
                                field="debtsTotal"
                                header="Debts"
                                body={(row: WealthProjectionMonth) => (
                                    <span className="text-red-600">
                                        -{formatCurrency(row.debtsTotal, displayCurrency)}
                                    </span>
                                )}
                            />
                            <Column
                                field="netWorth"
                                header="Net Worth"
                                body={(row: WealthProjectionMonth) => (
                                    <span className={`font-semibold ${row.netWorth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatCurrency(row.netWorth, displayCurrency)}
                                    </span>
                                )}
                            />
                        </DataTable>
                    </TabPanel>
                </TabView>
            </Card>
        </div>
    );
}
