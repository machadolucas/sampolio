'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import { useDashboardContext } from '@/components/layout/dashboard-layout';
import { CashflowChart, BalanceProjectionChart } from '@/components/charts';
import { getAccounts } from '@/lib/actions/accounts';
import { getProjection } from '@/lib/actions/projection';
import type { FinancialAccount, MonthlyProjection, YearlyRollup, Currency } from '@/types';

interface ProjectionData {
    monthly: MonthlyProjection[];
    yearly: YearlyRollup[];
    categories: string[];
    account: {
        id: string;
        name: string;
        currency: string;
        startingBalance: number;
        startingDate: string;
    };
}

export default function DashboardPage() {
    const dashboardContext = useDashboardContext();
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [projection, setProjection] = useState<ProjectionData | null>(null);
    const [viewMode, setViewMode] = useState<'monthly' | 'yearly'>('monthly');
    const [chartView, setChartView] = useState<'cashflow' | 'balance'>('cashflow');
    const [isLoading, setIsLoading] = useState(true);

    // Fetch accounts
    useEffect(() => {
        async function fetchAccountsData() {
            try {
                const result = await getAccounts();
                if (result.success && result.data) {
                    const activeAccounts = result.data.filter((a: FinancialAccount) => !a.isArchived);
                    setAccounts(activeAccounts);
                    if (activeAccounts.length > 0 && !selectedAccountId) {
                        setSelectedAccountId(activeAccounts[0].id);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch accounts:', err);
            } finally {
                setIsLoading(false);
            }
        }
        fetchAccountsData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch projection when account changes
    const fetchProjectionData = useCallback(async () => {
        if (!selectedAccountId) return;

        try {
            const result = await getProjection(selectedAccountId);
            if (result.success && result.data) {
                setProjection(result.data);
            }
        } catch (err) {
            console.error('Failed to fetch projection:', err);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        fetchProjectionData();
    }, [fetchProjectionData]);

    // Register refresh callback with dashboard context
    useEffect(() => {
        if (dashboardContext) {
            dashboardContext.setRefreshCallback(fetchProjectionData);
        }
    }, [dashboardContext, fetchProjectionData]);

    // Sync selected account with context
    useEffect(() => {
        if (dashboardContext && selectedAccountId) {
            dashboardContext.setSelectedAccountId(selectedAccountId);
        }
    }, [dashboardContext, selectedAccountId]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            </div>
        );
    }

    if (accounts.length === 0) {
        return (
            <div className="text-center py-16">
                <i className="pi pi-wallet text-6xl text-gray-400 mb-4"></i>
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    No financial accounts yet
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                    Create your first financial account to start planning your cashflow and tracking your finances.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                    Click &quot;Accounts&quot; in the top menu to get started.
                </p>
            </div>
        );
    }

    const currency = (projection?.account?.currency || 'EUR') as Currency;

    // Calculate summary stats
    const totalMonths = projection?.monthly?.length || 0;
    const firstMonth = projection?.monthly?.[0];
    const lastMonth = projection?.monthly?.[totalMonths - 1];
    const totalIncome = projection?.monthly?.reduce((sum, m) => sum + m.totalIncome, 0) || 0;
    const totalExpenses = projection?.monthly?.reduce((sum, m) => sum + m.totalExpenses, 0) || 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        View your cashflow projection and financial overview
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Dropdown
                        value={selectedAccountId}
                        onChange={(e: DropdownChangeEvent) => setSelectedAccountId(e.value)}
                        options={accounts.map(a => ({ value: a.id, label: a.name }))}
                        optionLabel="label"
                        optionValue="value"
                        placeholder="Select Account"
                        className="w-48"
                    />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Starting Balance</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                {formatCurrency(firstMonth?.startingBalance || 0, currency)}
                            </p>
                        </div>
                        <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                            <i className="pi pi-wallet text-xl text-blue-600 dark:text-blue-400"></i>
                        </div>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Projected End Balance</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                {formatCurrency(lastMonth?.endingBalance || 0, currency)}
                            </p>
                        </div>
                        <div className={`h-12 w-12 rounded-full flex items-center justify-center ${(lastMonth?.endingBalance || 0) >= (firstMonth?.startingBalance || 0)
                            ? 'bg-green-100 dark:bg-green-900'
                            : 'bg-red-100 dark:bg-red-900'
                            }`}>
                            <i className={`pi ${(lastMonth?.endingBalance || 0) >= (firstMonth?.startingBalance || 0) ? 'pi-arrow-up-right text-green-600 dark:text-green-400' : 'pi-arrow-down-right text-red-600 dark:text-red-400'} text-xl`}></i>
                        </div>
                    </div>
                </Card>
                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Income ({totalMonths} mo.)</p>
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                                {formatCurrency(totalIncome, currency)}
                            </p>
                        </div>
                        <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                            <i className="pi pi-arrow-up-right text-xl text-green-600 dark:text-green-400"></i>
                        </div>
                    </div>
                </Card>

                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Expenses ({totalMonths} mo.)</p>
                            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                                {formatCurrency(totalExpenses, currency)}
                            </p>
                        </div>
                        <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                            <i className="pi pi-arrow-down-right text-xl text-red-600 dark:text-red-400"></i>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Chart Section */}
            {projection?.monthly && projection.monthly.length > 0 && (
                <Card className="shadow-sm">
                    <div className="p-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Projection Chart</h3>
                            <div className="flex gap-2">
                                <Button
                                    label="Cashflow"
                                    icon="pi pi-chart-bar"
                                    size="small"
                                    severity={chartView === 'cashflow' ? undefined : 'secondary'}
                                    outlined={chartView !== 'cashflow'}
                                    onClick={() => setChartView('cashflow')}
                                />
                                <Button
                                    label="Balance"
                                    icon="pi pi-chart-line"
                                    size="small"
                                    severity={chartView === 'balance' ? undefined : 'secondary'}
                                    outlined={chartView !== 'balance'}
                                    onClick={() => setChartView('balance')}
                                />
                            </div>
                        </div>
                        {chartView === 'balance' ? (
                            <BalanceProjectionChart data={projection.monthly} currency={currency} />
                        ) : (
                            <CashflowChart data={projection.monthly} currency={currency} />
                        )}
                    </div>
                </Card>
            )}

            {/* View Toggle */}
            <div className="flex items-center gap-2">
                <Button
                    label="Monthly View"
                    severity={viewMode === 'monthly' ? undefined : 'secondary'}
                    outlined={viewMode !== 'monthly'}
                    size="small"
                    onClick={() => setViewMode('monthly')}
                />
                <Button
                    label="Yearly View"
                    severity={viewMode === 'yearly' ? undefined : 'secondary'}
                    outlined={viewMode !== 'yearly'}
                    size="small"
                    onClick={() => setViewMode('yearly')}
                />
            </div>

            {/* Projection Table */}
            <Card title={viewMode === 'monthly' ? 'Monthly Projection' : 'Yearly Summary'}>
                {viewMode === 'monthly' ? (
                    <DataTable
                        value={projection?.monthly || []}
                        emptyMessage="No projection data. Add some income or expenses to get started."
                        stripedRows
                        size="small"
                    >
                        <Column
                            field="yearMonth"
                            header="Month"
                            body={(row: MonthlyProjection) => formatYearMonth(row.yearMonth)}
                        />
                        <Column
                            field="startingBalance"
                            header="Starting"
                            align="right"
                            body={(row: MonthlyProjection) => formatCurrency(row.startingBalance, currency)}
                        />
                        <Column
                            header="Recurring Income"
                            align="right"
                            body={(row: MonthlyProjection) => {
                                const recurringIncome = row.incomeBreakdown
                                    .filter(item => item.source === 'recurring' || item.source === 'salary')
                                    .reduce((sum, item) => sum + item.amount, 0);
                                return <span className="text-green-600">+{formatCurrency(recurringIncome, currency)}</span>;
                            }}
                        />
                        <Column
                            header="Additional Income"
                            align="right"
                            body={(row: MonthlyProjection) => {
                                const additionalIncome = row.incomeBreakdown
                                    .filter(item => item.source === 'planned-one-off' || item.source === 'planned-repeating')
                                    .reduce((sum, item) => sum + item.amount, 0);
                                return additionalIncome > 0 ? <span className="text-green-500">+{formatCurrency(additionalIncome, currency)}</span> : <span className="text-gray-400">-</span>;
                            }}
                        />
                        <Column
                            header="Recurring Expenses"
                            align="right"
                            body={(row: MonthlyProjection) => {
                                const recurringExpenses = row.expenseBreakdown
                                    .filter(item => item.source === 'recurring')
                                    .reduce((sum, item) => sum + item.amount, 0);
                                return <span className="text-red-600">-{formatCurrency(recurringExpenses, currency)}</span>;
                            }}
                        />
                        <Column
                            header="Planned Expenses"
                            align="right"
                            body={(row: MonthlyProjection) => {
                                const plannedExpenses = row.expenseBreakdown
                                    .filter(item => item.source === 'planned-one-off' || item.source === 'planned-repeating')
                                    .reduce((sum, item) => sum + item.amount, 0);
                                return plannedExpenses > 0 ? <span className="text-red-500">-{formatCurrency(plannedExpenses, currency)}</span> : <span className="text-gray-400">-</span>;
                            }}
                        />
                        <Column
                            field="netChange"
                            header="Net Change"
                            align="right"
                            body={(row: MonthlyProjection) => (
                                <span className={`font-medium ${row.netChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.netChange >= 0 ? '+' : ''}{formatCurrency(row.netChange, currency)}
                                </span>
                            )}
                        />
                        <Column
                            field="endingBalance"
                            header="Ending"
                            align="right"
                            body={(row: MonthlyProjection) => <span className="font-medium">{formatCurrency(row.endingBalance, currency)}</span>}
                        />
                    </DataTable>
                ) : (
                    <DataTable
                        value={projection?.yearly || []}
                        emptyMessage="No projection data."
                        stripedRows
                        size="small"
                    >
                        <Column field="year" header="Year" />
                        <Column
                            field="startingBalance"
                            header="Starting"
                            align="right"
                            body={(row: YearlyRollup) => formatCurrency(row.startingBalance, currency)}
                        />
                        <Column
                            field="totalIncome"
                            header="Total Income"
                            align="right"
                            body={(row: YearlyRollup) => <span className="text-green-600">+{formatCurrency(row.totalIncome, currency)}</span>}
                        />
                        <Column
                            field="totalExpenses"
                            header="Total Expenses"
                            align="right"
                            body={(row: YearlyRollup) => <span className="text-red-600">-{formatCurrency(row.totalExpenses, currency)}</span>}
                        />
                        <Column
                            field="netChange"
                            header="Net Change"
                            align="right"
                            body={(row: YearlyRollup) => (
                                <span className={`font-medium ${row.netChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.netChange >= 0 ? '+' : ''}{formatCurrency(row.netChange, currency)}
                                </span>
                            )}
                        />
                        <Column
                            field="endingBalance"
                            header="Ending"
                            align="right"
                            body={(row: YearlyRollup) => <span className="font-medium">{formatCurrency(row.endingBalance, currency)}</span>}
                        />
                    </DataTable>
                )}
            </Card>
        </div>
    );
}
