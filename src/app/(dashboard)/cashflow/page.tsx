'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { TabView, TabPanel } from 'primereact/tabview';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Tag } from 'primereact/tag';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { formatCurrency, formatYearMonth, MONTHS_SHORT } from '@/lib/constants';
import { MonthlyFlowChart } from '@/components/charts/monthly-flow-chart';
import { BalanceProjectionChart } from '@/components/charts';
import { getAccounts } from '@/lib/actions/accounts';
import { getProjection } from '@/lib/actions/projection';
import type { FinancialAccount, MonthlyProjection, MonthFlowData, CashflowItem, Currency } from '@/types';

interface MonthStripProps {
    months: string[];
    selectedMonth: string;
    onSelectMonth: (month: string) => void;
    reconciledMonths?: Set<string>;
}

function MonthStrip({ months, selectedMonth, onSelectMonth, reconciledMonths = new Set() }: MonthStripProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const scrollRef = useRef<HTMLDivElement>(null);

    // Scroll to selected month on mount
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const selectedEl = container.querySelector(`[data-month="${selectedMonth}"]`);
        if (selectedEl) {
            selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [selectedMonth]);

    const currentMonth = useMemo(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }, []);

    return (
        <div
            ref={scrollRef}
            className={`flex gap-2 overflow-x-auto py-3 px-2 scrollbar-thin ${isDark ? 'scrollbar-thumb-gray-700' : 'scrollbar-thumb-gray-300'
                }`}
        >
            {months.map((month) => {
                const [year, m] = month.split('-');
                const isSelected = month === selectedMonth;
                const isCurrent = month === currentMonth;
                const isReconciled = reconciledMonths.has(month);

                return (
                    <button
                        key={month}
                        data-month={month}
                        onClick={() => onSelectMonth(month)}
                        className={`shrink-0 px-4 py-2 rounded-lg transition-all ${isSelected
                                ? isDark
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-blue-500 text-white'
                                : isCurrent
                                    ? isDark
                                        ? 'bg-gray-700 text-blue-400 border border-blue-500'
                                        : 'bg-blue-50 text-blue-600 border border-blue-300'
                                    : isDark
                                        ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        <div className="text-xs opacity-70">{year}</div>
                        <div className="font-medium">{MONTHS_SHORT[parseInt(m) - 1]}</div>
                        {isReconciled && (
                            <div className="flex justify-center mt-1">
                                <i className="pi pi-check-circle text-green-500 text-xs" />
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

interface MonthDetailsPanelProps {
    projection: MonthlyProjection | null;
    currency: Currency;
    onEditItem?: (itemId: string, source: string, itemType?: string) => void;
}

function MonthDetailsPanel({ projection, currency, onEditItem }: MonthDetailsPanelProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [incomeSortBy, setIncomeSortBy] = useState<'name' | 'amount'>('amount');
    const [expenseSortBy, setExpenseSortBy] = useState<'name' | 'amount'>('amount');

    if (!projection) {
        return (
            <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <i className="pi pi-calendar text-4xl mb-4" />
                <p>Select a month to view details</p>
            </div>
        );
    }

    const sortItems = (items: typeof projection.incomeBreakdown, sortBy: 'name' | 'amount') => {
        return [...items].sort((a, b) =>
            sortBy === 'amount' ? b.amount - a.amount : a.name.localeCompare(b.name)
        );
    };

    const SortToggle = ({ value, onChange }: { value: 'name' | 'amount'; onChange: (v: 'name' | 'amount') => void }) => (
        <div className="flex gap-1">
            <button
                className={`px-1.5 py-0.5 rounded text-xs ${value === 'amount'
                    ? isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-800'
                    : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                    }`}
                onClick={() => onChange('amount')}
            >
                Amount
            </button>
            <button
                className={`px-1.5 py-0.5 rounded text-xs ${value === 'name'
                    ? isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-800'
                    : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                    }`}
                onClick={() => onChange('name')}
            >
                Name
            </button>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className={`grid grid-cols-3 gap-4 p-4 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Income</div>
                    <div className="text-lg font-semibold text-green-500">
                        +{formatCurrency(projection.totalIncome, currency)}
                    </div>
                </div>
                <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Expenses</div>
                    <div className="text-lg font-semibold text-red-500">
                        -{formatCurrency(projection.totalExpenses, currency)}
                    </div>
                </div>
                <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Net Change</div>
                    <div className={`text-lg font-semibold ${projection.netChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {projection.netChange >= 0 ? '+' : ''}{formatCurrency(projection.netChange, currency)}
                    </div>
                </div>
            </div>

            {/* Balance */}
            <div className="flex justify-between items-center py-2">
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Starting Balance</span>
                <span className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    {formatCurrency(projection.startingBalance, currency)}
                </span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-gray-700">
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Ending Balance</span>
                <span className={`font-bold text-lg ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    {formatCurrency(projection.endingBalance, currency)}
                </span>
            </div>

            {/* Income Breakdown */}
            {projection.incomeBreakdown.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className={`text-sm font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Income
                        </h4>
                        <SortToggle value={incomeSortBy} onChange={setIncomeSortBy} />
                    </div>
                    <div className="space-y-2">
                        {sortItems(projection.incomeBreakdown, incomeSortBy).map((item) => (
                            <div
                                key={item.itemId}
                                className={`flex justify-between items-center p-2 rounded cursor-pointer transition-colors ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                    }`}
                                onClick={() => onEditItem?.(item.itemId, item.source, 'income')}
                            >
                                <div>
                                    <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>{item.name}</span>
                                    {item.category && (
                                        <Tag value={item.category} className="ml-2 text-xs" severity="info" />
                                    )}
                                </div>
                                <span className="text-green-500">+{formatCurrency(item.amount, currency)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Expense Breakdown */}
            {projection.expenseBreakdown.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className={`text-sm font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Expenses
                        </h4>
                        <SortToggle value={expenseSortBy} onChange={setExpenseSortBy} />
                    </div>
                    <div className="space-y-2">
                        {sortItems(projection.expenseBreakdown, expenseSortBy).map((item) => (
                            <div
                                key={item.itemId}
                                className={`flex justify-between items-center p-2 rounded cursor-pointer transition-colors ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                    }`}
                                onClick={() => onEditItem?.(item.itemId, item.source, 'expense')}
                            >
                                <div>
                                    <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>{item.name}</span>
                                    {item.category && (
                                        <Tag value={item.category} className="ml-2 text-xs" severity="warning" />
                                    )}
                                </div>
                                <span className="text-red-500">-{formatCurrency(item.amount, currency)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function CashflowPage() {
    const appContext = useAppContext();
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [isLoading, setIsLoading] = useState(true);
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [projection, setProjection] = useState<MonthlyProjection[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    // Fetch accounts
    useEffect(() => {
        async function fetchAccounts() {
            const result = await getAccounts();
            if (result.success && result.data) {
                const active = result.data.filter((a: FinancialAccount) => !a.isArchived);
                setAccounts(active);
                if (active.length > 0 && !selectedAccountId) {
                    setSelectedAccountId(active[0].id);
                }
            }
            setIsLoading(false);
        }
        fetchAccounts();
    }, [selectedAccountId]);

    // Fetch projection when account changes
    const fetchProjection = useCallback(async () => {
        if (!selectedAccountId) return;

        try {
            const result = await getProjection(selectedAccountId);
            if (result.success && result.data) {
                setProjection(result.data.monthly);
            }
        } catch (err) {
            console.error('Failed to fetch projection:', err);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        if (selectedAccountId) {
            fetchProjection();
        }
    }, [selectedAccountId, fetchProjection]);

    // Register refresh callback
    useEffect(() => {
        if (appContext) {
            appContext.setRefreshCallback(fetchProjection);
        }
    }, [appContext, fetchProjection]);

    // Get selected account
    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const currency = selectedAccount?.currency || 'EUR';

    // Get months list
    const months = useMemo(() => {
        return projection.map(p => p.yearMonth);
    }, [projection]);

    // Get selected month projection
    const selectedProjection = useMemo(() => {
        return projection.find(p => p.yearMonth === selectedMonth) || null;
    }, [projection, selectedMonth]);

    // Convert projection to flow data
    const flowData: MonthFlowData | null = useMemo(() => {
        if (!selectedProjection) return null;

        // Map source from ProjectionLineItem to CashflowItem source
        const mapSource = (src: string): CashflowItem['source'] => {
            if (src === 'planned-one-off' || src === 'planned-repeating') return 'planned';
            return src as CashflowItem['source'];
        };

        const inflows: CashflowItem[] = selectedProjection.incomeBreakdown.map(item => ({
            id: item.itemId,
            name: item.name,
            amount: item.amount,
            category: item.category,
            type: 'income' as const,
            source: mapSource(item.source),
            isRecurring: item.source === 'recurring' || item.source === 'salary',
        }));

        const outflows: CashflowItem[] = selectedProjection.expenseBreakdown.map(item => ({
            id: item.itemId,
            name: item.name,
            amount: item.amount,
            category: item.category,
            type: 'expense' as const,
            source: mapSource(item.source),
            isRecurring: item.source === 'recurring',
        }));

        return {
            yearMonth: selectedMonth,
            accountId: selectedAccountId,
            startingBalance: selectedProjection.startingBalance,
            endingBalance: selectedProjection.endingBalance,
            inflows,
            outflows,
            totalInflows: selectedProjection.totalIncome,
            totalOutflows: selectedProjection.totalExpenses,
            netChange: selectedProjection.netChange,
            isReconciled: false, // TODO: Check reconciliation status
        };
    }, [selectedProjection, selectedMonth, selectedAccountId]);

    const handleEditItem = (itemId: string, source: string, itemType?: string) => {
        // Map CashflowItem source to EntityModalRouter entityType
        let entityType = source;
        if (source === 'recurring') {
            entityType = itemType === 'income' ? 'income' : 'expense';
        } else if (source === 'taxed-income') {
            entityType = 'salary';
        } else if (source === 'debt-payment') {
            entityType = 'debt';
        }
        appContext?.openDrawer({
            mode: 'edit',
            entityType,
            entityId: itemId,
            yearMonth: selectedMonth,
        });
    };

    const handleAddItem = (type: 'income' | 'expense') => {
        appContext?.openDrawer({
            mode: 'create',
            entityType: type,
            yearMonth: selectedMonth,
        });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            </div>
        );
    }

    if (accounts.length === 0) {
        return (
            <Card>
                <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    <i className="pi pi-wallet text-5xl mb-4" />
                    <h2 className={`text-xl font-semibold mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        No Cash Accounts
                    </h2>
                    <p className="mb-4">Create a cash account to start tracking your cashflow.</p>
                    <Button
                        label="Create Account"
                        icon="pi pi-plus"
                        onClick={() => appContext?.openDrawer({ mode: 'create', entityType: 'account' })}
                    />
                </div>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Sticky Header + Month Strip */}
            <div className={`sticky top-0 z-10 -mx-6 px-6 pt-2 pb-4 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            Cashflow
                        </h1>
                        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Track income and expenses for your cash accounts
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Dropdown
                            value={selectedAccountId}
                            options={accounts.map(a => ({ label: a.name, value: a.id }))}
                            onChange={(e) => setSelectedAccountId(e.value)}
                            placeholder="Select Account"
                            className="w-48"
                        />
                        <Button
                            label="Add Income"
                            icon="pi pi-plus"
                            severity="success"
                            size="small"
                            onClick={() => handleAddItem('income')}
                        />
                        <Button
                            label="Add Expense"
                            icon="pi pi-minus"
                            severity="danger"
                            size="small"
                            onClick={() => handleAddItem('expense')}
                        />
                    </div>
                </div>

                {/* Month Strip */}
                <Card className="p-2!">
                    <MonthStrip
                        months={months}
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                    />
                </Card>
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Flow/Chart Area */}
                <div className="lg:col-span-2">
                    <Card>
                        <TabView>
                            <TabPanel header="Monthly Flow" leftIcon="pi pi-sitemap mr-2">
                                {flowData ? (
                                    <MonthlyFlowChart
                                        data={flowData}
                                        height="400px"
                                        onClickItem={(item) => {
                                            if (item.id === 'new') {
                                                handleAddItem(item.type as 'income' | 'expense');
                                            } else {
                                                handleEditItem(item.id, item.source, item.type);
                                            }
                                        }}
                                    />
                                ) : (
                                    <div className={`text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                        No data for selected month
                                    </div>
                                )}
                            </TabPanel>
                            <TabPanel header="Balance Chart" leftIcon="pi pi-chart-line mr-2">
                                <BalanceProjectionChart
                                    data={projection}
                                    currency={currency as Currency}
                                />
                            </TabPanel>
                            <TabPanel header="Data Table" leftIcon="pi pi-table mr-2">
                                <DataTable
                                    value={projection}
                                    scrollable
                                    scrollHeight="350px"
                                    size="small"
                                    stripedRows
                                    selectionMode="single"
                                    selection={selectedProjection}
                                    onSelectionChange={(e) => e.value && setSelectedMonth(e.value.yearMonth)}
                                >
                                    <Column
                                        field="yearMonth"
                                        header="Month"
                                        body={(row) => formatYearMonth(row.yearMonth)}
                                    />
                                    <Column
                                        field="totalIncome"
                                        header="Income"
                                        body={(row) => (
                                            <span className="text-green-500">
                                                +{formatCurrency(row.totalIncome, currency as Currency)}
                                            </span>
                                        )}
                                    />
                                    <Column
                                        field="totalExpenses"
                                        header="Expenses"
                                        body={(row) => (
                                            <span className="text-red-500">
                                                -{formatCurrency(row.totalExpenses, currency as Currency)}
                                            </span>
                                        )}
                                    />
                                    <Column
                                        field="netChange"
                                        header="Net"
                                        body={(row) => (
                                            <span className={row.netChange >= 0 ? 'text-green-500' : 'text-red-500'}>
                                                {row.netChange >= 0 ? '+' : ''}{formatCurrency(row.netChange, currency as Currency)}
                                            </span>
                                        )}
                                    />
                                    <Column
                                        field="endingBalance"
                                        header="Balance"
                                        body={(row) => formatCurrency(row.endingBalance, currency as Currency)}
                                    />
                                </DataTable>
                            </TabPanel>
                        </TabView>
                    </Card>
                </div>

                {/* Month Details Panel */}
                <div>
                    <Card>
                        <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            {selectedProjection ? formatYearMonth(selectedMonth) : 'Month Details'}
                        </h2>
                        <MonthDetailsPanel
                            projection={selectedProjection}
                            currency={currency as Currency}
                            onEditItem={handleEditItem}
                        />
                    </Card>
                </div>
            </div>
        </div>
    );
}
