'use client';

import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Tag } from 'primereact/tag';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { formatCurrency, formatYearMonth, MONTHS_SHORT } from '@/lib/constants';
import { MonthlyFlowChart } from '@/components/charts/monthly-flow-chart';
import { CashflowWaterfallChart, ExpenseTreemapChart } from '@/components/charts';
import { getAccounts } from '@/lib/actions/accounts';
import { getProjection } from '@/lib/actions/projection';
import type { FinancialAccount, MonthlyProjection, MonthFlowData, CashflowItem, Currency } from '@/types';
import { MdCheckCircle, MdCalendarToday, MdArrowForward, MdAccountBalanceWallet, MdAdd, MdRemove, MdList, MdAccountTree, MdBarChart, MdTableChart, MdInfoOutline } from 'react-icons/md';
import { Tooltip } from 'primereact/tooltip';

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
                                <MdCheckCircle className="text-green-500" size={12} />
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
                <MdCalendarToday size={36} className="mb-4" />
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
        <div className="space-y-2">
            {/* Balance Flow: Starting → Net → Ending */}
            <div className="flex items-center justify-between gap-2 py-2">
                <div className="text-center">
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Starting</div>
                    <div className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {formatCurrency(projection.startingBalance, currency)}
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <div className={`h-px w-4 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
                    <div className={`text-center px-2 py-1 rounded-full ${projection.netChange >= 0
                        ? 'bg-green-500/15 text-green-500'
                        : 'bg-red-500/15 text-red-500'
                        }`}>
                        <div className="text-xs font-medium">
                            {projection.netChange >= 0 ? '+' : ''}{formatCurrency(projection.netChange, currency)}
                        </div>
                    </div>
                    <div className={`h-px w-4 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
                    <MdArrowForward size={12} className={isDark ? 'text-gray-500' : 'text-gray-400'} />
                </div>
                <div className="text-center">
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Ending</div>
                    <div className={`text-lg font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {formatCurrency(projection.endingBalance, currency)}
                    </div>
                </div>
            </div>

            {/* Income Breakdown */}
            {projection.incomeBreakdown.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <h4 className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Income
                        </h4>
                        <SortToggle value={incomeSortBy} onChange={setIncomeSortBy} />
                    </div>
                    <div className="space-y-0">
                        {sortItems(projection.incomeBreakdown, incomeSortBy).map((item) => (
                            <div
                                key={item.itemId}
                                className={`flex justify-between items-center px-2 py-1 rounded cursor-pointer transition-colors text-sm ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                    }`}
                                onClick={() => onEditItem?.(item.itemId, item.source, 'income')}
                            >
                                <div className="flex items-center gap-1 min-w-0">
                                    <span className={`truncate ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{item.name}</span>
                                    {item.category && (
                                        <Tag value={item.category} className="text-xs !py-0 !px-1" severity="info" />
                                    )}
                                </div>
                                <span className="text-green-500 whitespace-nowrap ml-2">+{formatCurrency(item.amount, currency)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Expense Breakdown */}
            {projection.expenseBreakdown.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <h4 className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            Expenses
                        </h4>
                        <SortToggle value={expenseSortBy} onChange={setExpenseSortBy} />
                    </div>
                    <div className="space-y-0">
                        {sortItems(projection.expenseBreakdown, expenseSortBy).map((item) => (
                            <div
                                key={item.itemId}
                                className={`flex justify-between items-center px-2 py-1 rounded cursor-pointer transition-colors text-sm ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                    }`}
                                onClick={() => onEditItem?.(item.itemId, item.source, 'expense')}
                            >
                                <div className="flex items-center gap-1 min-w-0">
                                    <span className={`truncate ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{item.name}</span>
                                    {item.category && (
                                        <Tag value={item.category} className="text-xs !py-0 !px-1" severity="warning" />
                                    )}
                                </div>
                                <span className="text-red-500 whitespace-nowrap ml-2">-{formatCurrency(item.amount, currency)}</span>
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
    const hasLoadedOnce = useRef(false);
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
                if (hasLoadedOnce.current) {
                    // Smooth update without flash for refreshes
                    startTransition(() => {
                        setAccounts(active);
                        if (active.length > 0 && !selectedAccountId) {
                            setSelectedAccountId(active[0].id);
                        }
                    });
                } else {
                    setAccounts(active);
                    if (active.length > 0 && !selectedAccountId) {
                        setSelectedAccountId(active[0].id);
                    }
                }
            }
            if (!hasLoadedOnce.current) {
                hasLoadedOnce.current = true;
                setIsLoading(false);
            }
        }
        fetchAccounts();
    }, [selectedAccountId]);

    // Fetch projection when account changes
    const fetchProjection = useCallback(async () => {
        if (!selectedAccountId) return;

        try {
            const result = await getProjection(selectedAccountId);
            if (result.success && result.data) {
                // Use startTransition to avoid UI flash during refresh
                const monthly = result.data.monthly;
                startTransition(() => {
                    setProjection(monthly);
                });
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
        } else if (source === 'planned-one-off' || source === 'planned-repeating' || source === 'planned') {
            entityType = 'planned';
        } else if (source === 'taxed-income' || source === 'salary') {
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

    const handleManageItems = () => {
        appContext?.openDrawer({
            mode: 'view',
            entityType: 'cashflow-item',
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
                    <MdAccountBalanceWallet size={48} className="mb-4" />
                    <h2 className={`text-xl font-semibold mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        No Cash Accounts
                    </h2>
                    <p className="mb-4">Create a cash account to start tracking your cashflow.</p>
                    <Button
                        label="Create Account"
                        icon={<MdAdd />}
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
                            icon={<MdAdd />}
                            severity="success"
                            size="small"
                            onClick={() => handleAddItem('income')}
                        />
                        <Button
                            label="Add Expense"
                            icon={<MdRemove />}
                            severity="danger"
                            size="small"
                            onClick={() => handleAddItem('expense')}
                        />
                        <Button
                            label="Manage Items"
                            icon={<MdList />}
                            severity="secondary"
                            size="small"
                            outlined
                            onClick={handleManageItems}
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

            {/* Selected Month Banner */}
            {selectedProjection && (
                <Card className="!bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className={`text-xs uppercase tracking-wider mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Selected Month</p>
                            <h2 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                {formatYearMonth(selectedMonth)}
                            </h2>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                            <div className="text-center">
                                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Income</div>
                                <div className="text-green-500 font-semibold">+{formatCurrency(selectedProjection.totalIncome, currency as Currency)}</div>
                            </div>
                            <div className="text-center">
                                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Expenses</div>
                                <div className="text-red-500 font-semibold">-{formatCurrency(selectedProjection.totalExpenses, currency as Currency)}</div>
                            </div>
                            <div className="text-center">
                                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Net</div>
                                <div className={`font-semibold ${selectedProjection.netChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {selectedProjection.netChange >= 0 ? '+' : ''}{formatCurrency(selectedProjection.netChange, currency as Currency)}
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            )}

            {/* Charts: Left 2/3 (Flow + Projection stacked) | Right 1/3 (Details + Treemap stacked) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left column: 2/3 width */}
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <Tooltip target=".info-monthly-flow" position="top" />
                        <h3 className={`flex items-center font-semibold mb-3 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            <MdAccountTree className="mr-2" />Monthly Flow
                            <MdInfoOutline
                                className="info-monthly-flow ml-auto opacity-40 cursor-help"
                                size={16}
                                data-pr-tooltip="Sankey diagram showing how your income flows into expenses. Left side shows individual income sources, center aggregates into your budget, right side breaks down expenses by category and individual items."
                            />
                        </h3>
                        {flowData ? (
                            <MonthlyFlowChart
                                data={flowData}
                                height="350px"
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
                    </Card>

                    <Card>
                        <Tooltip target=".info-waterfall" position="top" />
                        <h3 className={`flex items-center font-semibold mb-3 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            <MdBarChart className="mr-2" />Cashflow Projection
                            <MdInfoOutline
                                className="info-waterfall ml-auto opacity-40 cursor-help"
                                size={16}
                                data-pr-tooltip="Waterfall chart showing your projected balance over time. Green bars represent income, red bars represent expenses, and the line tracks your running balance across months."
                            />
                        </h3>
                        <CashflowWaterfallChart
                            data={projection}
                            currency={currency as Currency}
                            height="350px"
                        />
                    </Card>
                </div>

                {/* Right column: 1/3 width */}
                <div className="space-y-6">
                    <Card>
                        <Tooltip target=".info-month-details" position="top" />
                        <h3 className={`flex items-center font-semibold mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            Month Details
                            <MdInfoOutline
                                className="info-month-details ml-auto opacity-40 cursor-help"
                                size={16}
                                data-pr-tooltip="Detailed breakdown of all income and expense items for the selected month. Shows starting and ending balance with the net change. Click any item to edit it."
                            />
                        </h3>
                        <MonthDetailsPanel
                            projection={selectedProjection}
                            currency={currency as Currency}
                            onEditItem={handleEditItem}
                        />
                    </Card>

                    {selectedProjection && selectedProjection.expenseBreakdown.length > 0 && (
                        <Card>
                            <Tooltip target=".info-treemap" position="top" />
                            <h3 className={`flex items-center font-semibold mb-3 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                <MdBarChart className="mr-2" />Expenses Breakdown
                                <MdInfoOutline
                                    className="info-treemap ml-auto opacity-40 cursor-help"
                                    size={16}
                                    data-pr-tooltip="Treemap showing the proportional size of each expense category and item for the selected month. Larger blocks represent bigger expenses, making it easy to spot where most money goes."
                                />
                            </h3>
                            <ExpenseTreemapChart
                                expenses={selectedProjection.expenseBreakdown}
                                currency={currency as Currency}
                                height="350px"
                            />
                        </Card>
                    )}
                </div>
            </div>

            {/* Data Table */}
            <div className={`mt-4 pt-6 border-t-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <p className={`text-xs uppercase tracking-wider mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>All Months Overview</p>
            </div>
            <Card>
                <Tooltip target=".info-projection" position="top" />
                <h3 className={`flex items-center font-semibold mb-3 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    <MdTableChart className="mr-2" />Projection Data
                    <MdInfoOutline
                        className="info-projection ml-auto opacity-40 cursor-help"
                        size={16}
                        data-pr-tooltip="Table showing the full projection across all months — not just the selected one. Displays income, expenses, net change, and running balance. Click any row to jump to that month."
                    />
                </h3>
                <DataTable
                    value={projection}
                    scrollable
                    scrollHeight="400px"
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
            </Card>
        </div>
    );
}
