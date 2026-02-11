'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch, InputSwitchChangeEvent } from 'primereact/inputswitch';
import { SelectButton, SelectButtonChangeEvent } from 'primereact/selectbutton';
import { Calendar } from 'primereact/calendar';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Toast } from 'primereact/toast';
import { Tooltip } from 'primereact/tooltip';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, FREQUENCIES, ITEM_CATEGORIES, formatYearMonth } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import {
    getRecurringItems,
    createRecurringItem,
    updateRecurringItem,
    deleteRecurringItem,
} from '@/lib/actions/recurring';
import {
    getPlannedItems,
    createPlannedItem,
    updatePlannedItem,
    deletePlannedItem,
} from '@/lib/actions/planned';
import {
    getSalaryConfigs,
    createSalaryConfig,
    updateSalaryConfig,
    deleteSalaryConfig,
} from '@/lib/actions/salary';
import { getUserPreferences } from '@/lib/actions/user-preferences';
import { MdArrowUpward, MdArrowDownward, MdAdd, MdCheckCircle, MdRadioButtonUnchecked, MdEdit, MdDelete, MdClose, MdCheck } from 'react-icons/md';
import type {
    FinancialAccount,
    RecurringItem,
    PlannedItem,
    SalaryConfig,
    SalaryBenefit,
    Currency,
    TaxDefaults,
} from '@/types';

function calculateNetSalary(
    grossSalary: number,
    taxRate: number,
    contributionsRate: number,
    otherDeductions: number,
    benefits: SalaryBenefit[] = []
): number {
    // Taxable benefits increase the tax/contributions base but are NOT received as cash
    const taxableBenefitsTotal = benefits.filter(b => b.isTaxable).reduce((sum, b) => sum + b.amount, 0);
    const taxableBase = grossSalary + taxableBenefitsTotal;
    const taxAmount = taxableBase * (taxRate / 100);
    const contributionsAmount = taxableBase * (contributionsRate / 100);
    // Net = gross minus all deductions (benefits are NOT added back since they are not received as cash)
    return grossSalary - taxAmount - contributionsAmount - otherDeductions;
}

// Unified item wrapper for the list
type UnifiedItem = {
    id: string;
    name: string;
    amount: number;
    displayAmount: number;
    type: 'income' | 'expense';
    recurrence: 'recurring' | 'one-off' | 'salary';
    category?: string;
    schedule: string;
    isActive: boolean;
    // References back to original data
    sourceType: 'recurring' | 'planned' | 'salary';
    originalItem: RecurringItem | PlannedItem | SalaryConfig;
};

interface CashflowItemModalProps {
    visible: boolean;
    onHide: () => void;
    selectedAccountId: string;
    accounts: FinancialAccount[];
    onAccountChange: (accountId: string) => void;
    onDataChange?: () => void;
    editItemId?: string;
    editItemSource?: string;
    initialType?: 'income' | 'expense';
    initialRecurrence?: 'recurring' | 'one-off' | 'salary';
    autoOpenForm?: boolean;
}

type FormRecurrence = 'recurring' | 'one-off' | 'salary';

interface FormData {
    type: 'income' | 'expense';
    recurrence: FormRecurrence;
    name: string;
    amount: string;
    category: string;
    // Recurring fields
    frequency: string;
    customIntervalMonths: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
    // One-off fields
    scheduledDate: string;
    // Salary fields
    grossSalary: string;
    taxRate: string;
    contributionsRate: string;
    otherDeductions: string;
    benefits: SalaryBenefit[];
    isLinkedToRecurring: boolean;
}

const TYPE_OPTIONS = [
    { label: 'Income', value: 'income', icon: <MdArrowUpward /> },
    { label: 'Expense', value: 'expense', icon: <MdArrowDownward /> },
];

const RECURRENCE_OPTIONS = [
    { label: 'Recurring', value: 'recurring' },
    { label: 'One-Off', value: 'one-off' },
    { label: 'Salary', value: 'salary' },
];

const RECURRENCE_OPTIONS_EXPENSE = [
    { label: 'Recurring', value: 'recurring' },
    { label: 'One-Off', value: 'one-off' },
];

/** Convert YYYY-MM string to Date (1st of that month) */
function yearMonthToDate(ym: string): Date | null {
    if (!ym) return null;
    const [year, month] = ym.split('-').map(Number);
    if (!year || !month) return null;
    return new Date(year, month - 1, 1);
}

/** Convert Date to YYYY-MM string */
function dateToYearMonth(date: Date | null | undefined): string {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function HelpTip({ text }: { text: string }) {
    return <small className="block mt-1 opacity-60">{text}</small>;
}

function MonthPicker({ value, onChange, placeholder, helpText }: { value: string; onChange: (ym: string) => void; placeholder?: string; helpText?: string }) {
    return (
        <div>
            <Calendar
                value={yearMonthToDate(value)}
                onChange={(e) => onChange(dateToYearMonth(e.value as Date))}
                view="month"
                dateFormat="yy-mm"
                placeholder={placeholder || 'Select month'}
                showIcon
                className="w-full"
            />
            {helpText && <HelpTip text={helpText} />}
        </div>
    );
}

export function CashflowItemModal({
    visible,
    onHide,
    selectedAccountId,
    accounts,
    onAccountChange,
    onDataChange,
    editItemId,
    editItemSource,
    initialType,
    initialRecurrence,
    autoOpenForm,
}: CashflowItemModalProps) {
    const toastRef = useRef<Toast>(null);
    const [recurringItems, setRecurringItems] = useState<RecurringItem[]>([]);
    const [plannedItems, setPlannedItems] = useState<PlannedItem[]>([]);
    const [salaryConfigs, setSalaryConfigs] = useState<SalaryConfig[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<UnifiedItem | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
    const [filterRecurrence, setFilterRecurrence] = useState<'all' | 'recurring' | 'one-off' | 'salary'>('all');
    const [taxDefaults, setTaxDefaults] = useState<TaxDefaults | null>(null);

    const defaultFormData: FormData = useMemo(() => ({
        type: initialType || 'income',
        recurrence: initialRecurrence || 'recurring',
        name: '',
        amount: '',
        category: '',
        frequency: 'monthly',
        customIntervalMonths: '1',
        startDate: getCurrentYearMonth(),
        endDate: '',
        isActive: true,
        scheduledDate: getCurrentYearMonth(),
        grossSalary: '',
        taxRate: taxDefaults?.taxRate?.toString() ?? '',
        contributionsRate: taxDefaults?.contributionsRate?.toString() ?? '',
        otherDeductions: taxDefaults?.otherDeductions?.toString() ?? '0',
        benefits: [],
        isLinkedToRecurring: true,
    }), [initialType, initialRecurrence, taxDefaults]);

    const [formData, setFormData] = useState<FormData>(defaultFormData);

    // Load tax defaults
    useEffect(() => {
        getUserPreferences().then(result => {
            if (result.success && result.data?.taxDefaults) {
                setTaxDefaults(result.data.taxDefaults);
            }
        });
    }, []);

    // Fetch all items
    const fetchAll = useCallback(async () => {
        if (!selectedAccountId) return;
        setIsLoading(true);
        try {
            const [recResult, planResult, salResult] = await Promise.all([
                getRecurringItems(selectedAccountId),
                getPlannedItems(selectedAccountId),
                getSalaryConfigs(selectedAccountId),
            ]);
            if (recResult.success && recResult.data) setRecurringItems(recResult.data);
            if (planResult.success && planResult.data) setPlannedItems(planResult.data);
            if (salResult.success && salResult.data) setSalaryConfigs(salResult.data);
        } catch (err) {
            console.error('Failed to fetch items:', err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        if (visible && selectedAccountId) {
            fetchAll();
        }
    }, [visible, selectedAccountId, fetchAll]);

    const account = accounts.find(a => a.id === selectedAccountId);
    const currency = (account?.currency || 'EUR') as Currency;

    // Build unified list
    const unifiedItems: UnifiedItem[] = useMemo(() => {
        const items: UnifiedItem[] = [];

        // Collect IDs of recurring items linked to salary configs
        const salaryLinkedIds = new Set(
            salaryConfigs
                .filter(s => s.isLinkedToRecurring && s.linkedRecurringItemId)
                .map(s => s.linkedRecurringItemId!)
        );

        recurringItems.forEach(item => {
            // Skip recurring items that are linked to a salary config (shown as salary instead)
            if (salaryLinkedIds.has(item.id)) return;

            items.push({
                id: item.id,
                name: item.name,
                amount: item.amount,
                displayAmount: item.amount,
                type: item.type,
                recurrence: 'recurring',
                category: item.category,
                schedule: `${item.frequency}${item.endDate ? `, until ${formatYearMonth(item.endDate)}` : ''}`,
                isActive: item.isActive,
                sourceType: 'recurring',
                originalItem: item,
            });
        });

        plannedItems.forEach(item => {
            items.push({
                id: item.id,
                name: item.name,
                amount: item.amount,
                displayAmount: item.amount,
                type: item.type,
                recurrence: item.kind === 'one-off' ? 'one-off' : 'recurring',
                category: item.category,
                schedule: item.kind === 'one-off'
                    ? (item.scheduledDate ? formatYearMonth(item.scheduledDate) : '')
                    : `${item.frequency || ''} from ${item.firstOccurrence ? formatYearMonth(item.firstOccurrence) : ''}`,
                isActive: true,
                sourceType: 'planned',
                originalItem: item,
            });
        });

        salaryConfigs.forEach(config => {
            items.push({
                id: config.id,
                name: config.name,
                amount: config.netSalary,
                displayAmount: config.netSalary,
                type: 'income',
                recurrence: 'salary',
                category: 'Salary',
                schedule: `Gross: ${formatCurrency(config.grossSalary, currency)}`,
                isActive: config.isActive,
                sourceType: 'salary',
                originalItem: config,
            });
        });

        return items.sort((a, b) => b.amount - a.amount);
    }, [recurringItems, plannedItems, salaryConfigs, currency]);

    // Auto-open edit form when editItemId is provided
    useEffect(() => {
        if (editItemId && unifiedItems.length > 0 && !isFormOpen) {
            const item = unifiedItems.find(i => i.id === editItemId);
            if (item) {
                openEditForm(item);
            }
        }
    }, [editItemId, unifiedItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-open add form when autoOpenForm is true (e.g. from Add Income/Expense buttons)
    useEffect(() => {
        if (autoOpenForm && visible && !editItemId && !isLoading && !isFormOpen) {
            setEditingItem(null);
            setFormData({
                ...defaultFormData,
                taxRate: taxDefaults?.taxRate?.toString() ?? '',
                contributionsRate: taxDefaults?.contributionsRate?.toString() ?? '',
                otherDeductions: taxDefaults?.otherDeductions?.toString() ?? '0',
            });
            setIsFormOpen(true);
        }
    }, [autoOpenForm, visible, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetForm = useCallback(() => {
        setFormData({
            ...defaultFormData,
            taxRate: taxDefaults?.taxRate?.toString() ?? '',
            contributionsRate: taxDefaults?.contributionsRate?.toString() ?? '',
            otherDeductions: taxDefaults?.otherDeductions?.toString() ?? '0',
        });
        setEditingItem(null);
    }, [defaultFormData, taxDefaults]);

    const openNewForm = (type?: 'income' | 'expense', recurrence?: FormRecurrence) => {
        resetForm();
        if (type) setFormData(prev => ({ ...prev, type }));
        if (recurrence) setFormData(prev => ({ ...prev, recurrence }));
        setIsFormOpen(true);
    };

    const openEditForm = (item: UnifiedItem) => {
        setEditingItem(item);
        const orig = item.originalItem;

        if (item.sourceType === 'recurring') {
            const r = orig as RecurringItem;
            setFormData({
                ...defaultFormData,
                type: r.type,
                recurrence: 'recurring',
                name: r.name,
                amount: r.amount.toString(),
                category: r.category || '',
                frequency: r.frequency,
                customIntervalMonths: r.customIntervalMonths?.toString() || '1',
                startDate: r.startDate,
                endDate: r.endDate || '',
                isActive: r.isActive,
            });
        } else if (item.sourceType === 'planned') {
            const p = orig as PlannedItem;
            setFormData({
                ...defaultFormData,
                type: p.type,
                recurrence: p.kind === 'one-off' ? 'one-off' : 'recurring',
                name: p.name,
                amount: p.amount.toString(),
                category: p.category || '',
                scheduledDate: p.scheduledDate || getCurrentYearMonth(),
                frequency: p.frequency || 'yearly',
                customIntervalMonths: p.customIntervalMonths?.toString() || '12',
                startDate: p.firstOccurrence || getCurrentYearMonth(),
                endDate: p.endDate || '',
            });
        } else if (item.sourceType === 'salary') {
            const s = orig as SalaryConfig;
            setFormData({
                ...defaultFormData,
                type: 'income',
                recurrence: 'salary',
                name: s.name,
                amount: '',
                grossSalary: s.grossSalary.toString(),
                taxRate: s.taxRate.toString(),
                contributionsRate: s.contributionsRate.toString(),
                otherDeductions: s.otherDeductions.toString(),
                benefits: s.benefits || [],
                startDate: s.startDate,
                endDate: s.endDate || '',
                isActive: s.isActive,
                isLinkedToRecurring: s.isLinkedToRecurring,
            });
        }
        setIsFormOpen(true);
    };

    const handleSubmit = async () => {
        try {
            if (formData.recurrence === 'salary') {
                // Salary config
                const body = {
                    name: formData.name,
                    grossSalary: parseFloat(formData.grossSalary),
                    benefits: formData.benefits,
                    taxRate: parseFloat(formData.taxRate),
                    contributionsRate: parseFloat(formData.contributionsRate),
                    otherDeductions: parseFloat(formData.otherDeductions) || 0,
                    startDate: formData.startDate,
                    endDate: formData.endDate || undefined,
                    isActive: formData.isActive,
                    isLinkedToRecurring: formData.isLinkedToRecurring,
                };
                if (editingItem?.sourceType === 'salary') {
                    await updateSalaryConfig(selectedAccountId, editingItem.id, body);
                } else {
                    await createSalaryConfig(selectedAccountId, body);
                }
            } else if (formData.recurrence === 'one-off') {
                // Planned one-off item
                const body = {
                    type: formData.type as 'income' | 'expense',
                    kind: 'one-off' as const,
                    name: formData.name,
                    amount: parseFloat(formData.amount),
                    category: formData.category || undefined,
                    scheduledDate: formData.scheduledDate,
                };
                if (editingItem?.sourceType === 'planned') {
                    await updatePlannedItem(selectedAccountId, editingItem.id, body);
                } else {
                    await createPlannedItem(selectedAccountId, body);
                }
            } else {
                // Recurring item
                const body = {
                    type: formData.type as 'income' | 'expense',
                    name: formData.name,
                    amount: parseFloat(formData.amount),
                    category: formData.category || undefined,
                    frequency: formData.frequency as 'monthly' | 'quarterly' | 'yearly' | 'custom',
                    customIntervalMonths: formData.frequency === 'custom' ? parseInt(formData.customIntervalMonths, 10) : undefined,
                    startDate: formData.startDate,
                    endDate: formData.endDate || undefined,
                    isActive: formData.isActive,
                };
                if (editingItem?.sourceType === 'recurring') {
                    await updateRecurringItem(selectedAccountId, editingItem.id, body);
                } else {
                    await createRecurringItem(selectedAccountId, body);
                }
            }

            await fetchAll();
            setIsFormOpen(false);
            resetForm();
            onDataChange?.();
            toastRef.current?.show({ severity: 'success', summary: 'Success', detail: editingItem ? 'Item updated successfully' : 'Item created successfully', life: 3000 });
            if (isStandaloneFormMode) onHide();
        } catch (err) {
            console.error('Failed to save:', err);
            toastRef.current?.show({ severity: 'error', summary: 'Error', detail: 'Failed to save item', life: 3000 });
        }
    };

    const handleDelete = async (item: UnifiedItem) => {
        const label = item.sourceType === 'salary'
            ? 'Delete this salary configuration? This will also remove the linked recurring income item.'
            : 'Delete this item?';
        if (!confirm(label)) return;

        try {
            if (item.sourceType === 'recurring') {
                await deleteRecurringItem(selectedAccountId, item.id);
            } else if (item.sourceType === 'planned') {
                await deletePlannedItem(selectedAccountId, item.id);
            } else if (item.sourceType === 'salary') {
                await deleteSalaryConfig(selectedAccountId, item.id);
            }
            await fetchAll();
            onDataChange?.();
            toastRef.current?.show({ severity: 'success', summary: 'Deleted', detail: 'Item deleted successfully', life: 3000 });
        } catch (err) {
            console.error('Failed to delete:', err);
            toastRef.current?.show({ severity: 'error', summary: 'Error', detail: 'Failed to delete item', life: 3000 });
        }
    };

    const handleToggleActive = async (item: UnifiedItem) => {
        try {
            if (item.sourceType === 'recurring') {
                await updateRecurringItem(selectedAccountId, item.id, { isActive: !item.isActive });
            } else if (item.sourceType === 'salary') {
                await updateSalaryConfig(selectedAccountId, item.id, { isActive: !item.isActive });
            }
            await fetchAll();
            onDataChange?.();
            toastRef.current?.show({ severity: 'success', summary: 'Updated', detail: `Item ${!item.isActive ? 'activated' : 'deactivated'}`, life: 3000 });
        } catch (err) {
            console.error('Failed to toggle:', err);
            toastRef.current?.show({ severity: 'error', summary: 'Error', detail: 'Failed to update status', life: 3000 });
        }
    };

    // Filters
    const filteredItems = unifiedItems.filter(item => {
        if (filterType !== 'all' && item.type !== filterType) return false;
        if (filterRecurrence !== 'all' && item.recurrence !== filterRecurrence) return false;
        return true;
    });

    const totalIncome = unifiedItems.filter(i => i.type === 'income' && i.isActive).reduce((s, i) => s + i.displayAmount, 0);
    const totalExpenses = unifiedItems.filter(i => i.type === 'expense' && i.isActive).reduce((s, i) => s + i.displayAmount, 0);

    // Salary preview in form
    const previewNetSalary = formData.recurrence === 'salary' ? calculateNetSalary(
        parseFloat(formData.grossSalary) || 0,
        parseFloat(formData.taxRate) || 0,
        parseFloat(formData.contributionsRate) || 0,
        parseFloat(formData.otherDeductions) || 0,
        formData.benefits
    ) : 0;

    const recurrenceOptions = formData.type === 'expense' ? RECURRENCE_OPTIONS_EXPENSE : RECURRENCE_OPTIONS;

    const formTitle = editingItem
        ? `Edit ${editingItem.recurrence === 'salary' ? 'Salary' : 'Item'}`
        : 'Add Item';

    // Skip the full items list dialog and show only the form when:
    // - autoOpenForm is true (create mode from Add Income/Expense buttons), or
    // - editItemId is set (editing a specific item directly)
    const isStandaloneFormMode = autoOpenForm || !!editItemId;

    const handleFormClose = () => {
        setIsFormOpen(false);
        resetForm();
        if (isStandaloneFormMode) onHide();
    };

    return (
        <>
            <Toast ref={toastRef} />
            {!isStandaloneFormMode && (
                <Dialog
                    header="Cashflow Items"
                    visible={visible}
                    onHide={onHide}
                    style={{ width: '95vw', maxWidth: '1400px' }}
                    maximizable
                    modal
                    dismissableMask
                >
                    <div className="space-y-4">
                        {/* Header */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <Dropdown
                                    value={selectedAccountId}
                                    onChange={(e: DropdownChangeEvent) => onAccountChange(e.value)}
                                    options={accounts.filter(a => !a.isArchived).map(a => ({ value: a.id, label: a.name }))}
                                    optionLabel="label"
                                    optionValue="value"
                                    placeholder="Select Account"
                                    className="w-48"
                                />
                                <div className="flex gap-1">
                                    {(['all', 'income', 'expense'] as const).map(t => (
                                        <Button
                                            key={t}
                                            label={t.charAt(0).toUpperCase() + t.slice(1)}
                                            size="small"
                                            severity={filterType === t ? undefined : 'secondary'}
                                            outlined={filterType !== t}
                                            onClick={() => setFilterType(t)}
                                        />
                                    ))}
                                </div>
                                <div className="flex gap-1">
                                    {(['all', 'recurring', 'one-off', 'salary'] as const).map(r => (
                                        <Button
                                            key={r}
                                            label={r === 'one-off' ? 'One-off' : r.charAt(0).toUpperCase() + r.slice(1)}
                                            size="small"
                                            severity={filterRecurrence === r ? undefined : 'secondary'}
                                            outlined={filterRecurrence !== r}
                                            onClick={() => setFilterRecurrence(r)}
                                        />
                                    ))}
                                </div>
                            </div>
                            <Button label="Add Item" icon={<MdAdd />} onClick={() => openNewForm()} />
                        </div>

                        {/* Summary */}
                        <div className="grid grid-cols-3 gap-4">
                            <Card className="p-3!">
                                <div className="text-center">
                                    <p className="text-sm text-gray-500">Monthly Income</p>
                                    <p className="text-xl font-bold text-green-600">{formatCurrency(totalIncome, currency)}</p>
                                </div>
                            </Card>
                            <Card className="p-3!">
                                <div className="text-center">
                                    <p className="text-sm text-gray-500">Monthly Expenses</p>
                                    <p className="text-xl font-bold text-red-600">{formatCurrency(totalExpenses, currency)}</p>
                                </div>
                            </Card>
                            <Card className="p-3!">
                                <div className="text-center">
                                    <p className="text-sm text-gray-500">Net Monthly</p>
                                    <p className={`text-xl font-bold ${totalIncome - totalExpenses >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatCurrency(totalIncome - totalExpenses, currency)}
                                    </p>
                                </div>
                            </Card>
                        </div>

                        {/* Items List */}
                        {isLoading ? (
                            <div className="flex justify-center py-8">
                                <ProgressSpinner style={{ width: '40px', height: '40px' }} />
                            </div>
                        ) : filteredItems.length === 0 ? (
                            <div className="text-center py-8 opacity-50">
                                No items yet. Click &quot;Add Item&quot; to create one.
                            </div>
                        ) : (
                            <DataTable
                                value={filteredItems}
                                dataKey="id"
                                size="small"
                                stripedRows
                                rowHover
                                emptyMessage="No items match the current filters."
                            >
                                <Column header="Name" body={(item: UnifiedItem) => (
                                    <div>
                                        <span className="font-medium">{item.name}</span>
                                        {item.category && <span className="block text-xs opacity-60">{item.category}</span>}
                                    </div>
                                )} />
                                <Column header="Type" body={(item: UnifiedItem) => (
                                    <Tag value={item.type} severity={item.type === 'income' ? 'success' : 'danger'} />
                                )} />
                                <Column header="Recurrence" body={(item: UnifiedItem) => (
                                    <Tag
                                        value={item.recurrence === 'salary' ? 'Salary' : item.recurrence === 'one-off' ? 'One-off' : 'Recurring'}
                                        severity={item.recurrence === 'salary' ? 'info' : item.recurrence === 'one-off' ? 'warning' : 'secondary'}
                                    />
                                )} />
                                <Column header="Amount" align="right" body={(item: UnifiedItem) => (
                                    <span className={`font-medium ${item.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                                        {item.type === 'income' ? '+' : '-'}{formatCurrency(item.displayAmount, currency)}
                                    </span>
                                )} sortable sortField="displayAmount" />
                                <Column header="Schedule" body={(item: UnifiedItem) => (
                                    <span className="text-xs opacity-60">{item.schedule}</span>
                                )} />
                                <Column header="Status" align="center" body={(item: UnifiedItem) => (
                                    <Tag value={item.isActive ? 'Active' : 'Inactive'} severity={item.isActive ? 'success' : 'secondary'} />
                                )} />
                                <Column header="Actions" align="right" body={(item: UnifiedItem) => (
                                    <div className="flex justify-end gap-1">
                                        {(item.sourceType === 'recurring' || item.sourceType === 'salary') && (
                                            <Button
                                                icon={item.isActive ? <MdCheckCircle /> : <MdRadioButtonUnchecked />}
                                                text size="small"
                                                tooltip={item.isActive ? 'Deactivate' : 'Activate'}
                                                tooltipOptions={{ position: 'top' }}
                                                onClick={() => handleToggleActive(item)}
                                            />
                                        )}
                                        <Button icon={<MdEdit />} text size="small" tooltip="Edit" tooltipOptions={{ position: 'top' }} onClick={() => openEditForm(item)} />
                                        <Button icon={<MdDelete />} text size="small" severity="danger" tooltip="Delete" tooltipOptions={{ position: 'top' }} onClick={() => handleDelete(item)} />
                                    </div>
                                )} />
                            </DataTable>
                        )}
                    </div>
                </Dialog>
            )}

            {/* Form Dialog */}
            <Dialog
                header={formTitle}
                visible={isFormOpen}
                onHide={handleFormClose}
                style={{ width: '550px' }}
                modal
            >
                <div className="space-y-4">
                    {/* Type: Income / Expense */}
                    <div>
                        <label className="text-sm font-medium mb-1 block">Type</label>
                        <SelectButton
                            value={formData.type}
                            onChange={(e: SelectButtonChangeEvent) => {
                                const newType = e.value as 'income' | 'expense';
                                setFormData(p => ({
                                    ...p,
                                    type: newType,
                                    recurrence: newType === 'expense' && p.recurrence === 'salary' ? 'recurring' : p.recurrence,
                                }));
                            }}
                            options={TYPE_OPTIONS}
                            optionLabel="label"
                            optionValue="value"
                            className="w-full"
                            disabled={editingItem?.sourceType === 'salary'}
                        />
                        <HelpTip text="Income = money coming in. Expense = money going out." />
                    </div>

                    {/* Recurrence: Recurring / One-off / Salary */}
                    <div>
                        <label className="text-sm font-medium mb-1 block">Recurrence</label>
                        <SelectButton
                            value={formData.recurrence}
                            onChange={(e: SelectButtonChangeEvent) => setFormData(p => ({ ...p, recurrence: e.value as FormRecurrence }))}
                            options={recurrenceOptions}
                            optionLabel="label"
                            optionValue="value"
                            className="w-full"
                            disabled={!!editingItem}
                        />
                        <HelpTip text="Recurring = repeats on a schedule. One-off = happens once. Salary = income with tax/deduction calculations." />
                    </div>

                    {/* Name */}
                    <div>
                        <label className="text-sm font-medium">Name</label>
                        <InputText
                            value={formData.name}
                            onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                            placeholder={formData.recurrence === 'salary' ? 'e.g., Main Job' : formData.type === 'income' ? 'e.g., Freelance Work, Dividends' : 'e.g., Rent, Groceries, Netflix'}
                            className="w-full"
                        />
                        <HelpTip text="A descriptive name to identify this item." />
                    </div>

                    {/* Amount (not for salary - salary uses grossSalary) */}
                    {formData.recurrence !== 'salary' && (
                        <div>
                            <label className="text-sm font-medium">Amount ({currency})</label>
                            <InputNumber
                                value={formData.amount ? parseFloat(formData.amount) : null}
                                onValueChange={e => setFormData(p => ({ ...p, amount: e.value?.toString() || '' }))}
                                mode="currency"
                                currency={currency}
                                locale="fi-FI"
                                placeholder="0.00"
                                className="w-full"
                            />
                            <HelpTip text={formData.recurrence === 'recurring' ? 'The amount per occurrence (e.g., monthly rent amount).' : 'The one-time amount for this item.'} />
                        </div>
                    )}

                    {/* Category (not for salary) */}
                    {formData.recurrence !== 'salary' && (
                        <div>
                            <label className="text-sm font-medium">Category</label>
                            <Dropdown
                                value={formData.category}
                                onChange={e => setFormData(p => ({ ...p, category: e.value }))}
                                options={[{ value: '', label: 'None' }, ...ITEM_CATEGORIES.map(c => ({ value: c, label: c }))]}
                                optionLabel="label"
                                optionValue="value"
                                placeholder="Select a category"
                                className="w-full"
                            />
                            <HelpTip text="Optional grouping for reporting and charts." />
                        </div>
                    )}

                    {/* === SALARY SPECIFIC FIELDS === */}
                    {formData.recurrence === 'salary' && (
                        <>
                            <div>
                                <label className="text-sm font-medium">Gross Salary (Monthly)</label>
                                <InputNumber
                                    value={formData.grossSalary ? parseFloat(formData.grossSalary) : null}
                                    onValueChange={e => setFormData(p => ({ ...p, grossSalary: e.value?.toString() || '' }))}
                                    mode="currency"
                                    currency={currency}
                                    locale="fi-FI"
                                    placeholder="Your monthly gross salary"
                                    className="w-full"
                                />
                                <HelpTip text="Your salary before taxes and deductions. The net amount will be calculated automatically." />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium">Tax Rate (%)</label>
                                    <InputNumber
                                        value={formData.taxRate ? parseFloat(formData.taxRate) : null}
                                        onValueChange={e => setFormData(p => ({ ...p, taxRate: e.value?.toString() || '' }))}
                                        suffix=" %"
                                        locale="fi-FI"
                                        minFractionDigits={0}
                                        maxFractionDigits={2}
                                        placeholder="e.g., 25,50"
                                        className="w-full"
                                    />
                                    <HelpTip text="Your income tax rate." />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Contributions (%)</label>
                                    <InputNumber
                                        value={formData.contributionsRate ? parseFloat(formData.contributionsRate) : null}
                                        onValueChange={e => setFormData(p => ({ ...p, contributionsRate: e.value?.toString() || '' }))}
                                        suffix=" %"
                                        locale="fi-FI"
                                        minFractionDigits={0}
                                        maxFractionDigits={2}
                                        placeholder="e.g., 7,15"
                                        className="w-full"
                                    />
                                    <HelpTip text="Social security or pension contributions." />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Other Deductions (Fixed Amount)</label>
                                <InputNumber
                                    value={formData.otherDeductions ? parseFloat(formData.otherDeductions) : null}
                                    onValueChange={e => setFormData(p => ({ ...p, otherDeductions: e.value?.toString() || '0' }))}
                                    mode="currency"
                                    currency={currency}
                                    locale="fi-FI"
                                    placeholder="0.00"
                                    className="w-full"
                                />
                                <HelpTip text="Any fixed monthly deductions (e.g., union fees, insurance)." />
                            </div>

                            {/* Benefits */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium">Benefits</label>
                                    <Button
                                        label="Add Benefit"
                                        icon={<MdAdd />}
                                        size="small"
                                        text
                                        onClick={() => setFormData(p => ({
                                            ...p,
                                            benefits: [...p.benefits, { id: crypto.randomUUID(), name: '', amount: 0, isTaxable: true }],
                                        }))}
                                    />
                                </div>
                                <HelpTip text="Additional benefits like meal vouchers, health insurance, etc. Mark whether each benefit is taxable." />
                                {formData.benefits.length > 0 && (
                                    <div className="space-y-2 mt-2">
                                        {formData.benefits.map((benefit, index) => (
                                            <div key={benefit.id} className="flex items-center gap-2 p-2 surface-ground border-round">
                                                <InputText
                                                    placeholder="e.g., Meal Voucher"
                                                    value={benefit.name}
                                                    onChange={e => {
                                                        const benefits = [...formData.benefits];
                                                        benefits[index] = { ...benefits[index], name: e.target.value };
                                                        setFormData(p => ({ ...p, benefits }));
                                                    }}
                                                    className="flex-1"
                                                    size={1}
                                                />
                                                <InputNumber
                                                    placeholder="0"
                                                    value={benefit.amount}
                                                    onValueChange={e => {
                                                        const benefits = [...formData.benefits];
                                                        benefits[index] = { ...benefits[index], amount: e.value ?? 0 };
                                                        setFormData(p => ({ ...p, benefits }));
                                                    }}
                                                    mode="currency"
                                                    currency={currency}
                                                    locale="fi-FI"
                                                    className="w-28"
                                                />
                                                <div className="flex items-center gap-1">
                                                    <InputSwitch
                                                        checked={benefit.isTaxable}
                                                        onChange={(e: InputSwitchChangeEvent) => {
                                                            const benefits = [...formData.benefits];
                                                            benefits[index] = { ...benefits[index], isTaxable: e.value ?? true };
                                                            setFormData(p => ({ ...p, benefits }));
                                                        }}
                                                    />
                                                    <span className="text-xs whitespace-nowrap">{benefit.isTaxable ? 'Taxable' : 'Non-tax'}</span>
                                                </div>
                                                <Button
                                                    icon={<MdClose />}
                                                    rounded
                                                    text
                                                    severity="danger"
                                                    size="small"
                                                    onClick={() => setFormData(p => ({ ...p, benefits: p.benefits.filter((_, i) => i !== index) }))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Net salary preview */}
                            <div className="p-4 surface-ground border-round-lg space-y-1">
                                {formData.benefits.length > 0 && (
                                    <div className="flex justify-between text-xs opacity-60">
                                        <span>Taxable Gross</span>
                                        <span>{formatCurrency(
                                            (parseFloat(formData.grossSalary) || 0) + formData.benefits.filter(b => b.isTaxable).reduce((s, b) => s + b.amount, 0),
                                            currency
                                        )}</span>
                                    </div>
                                )}
                                <div className="flex justify-between items-center">
                                    <span className="text-sm opacity-60">Calculated Net Salary</span>
                                    <span className="text-xl font-bold text-green-600">{formatCurrency(previewNetSalary, currency)}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <InputSwitch
                                    checked={formData.isLinkedToRecurring}
                                    onChange={(e: InputSwitchChangeEvent) => setFormData(p => ({ ...p, isLinkedToRecurring: e.value ?? false }))}
                                />
                                <label className="text-sm">Add as recurring income item</label>
                            </div>
                            <HelpTip text="When enabled, a recurring income entry is automatically created based on the net salary." />
                        </>
                    )}

                    {/* === RECURRING SPECIFIC FIELDS === */}
                    {formData.recurrence === 'recurring' && (
                        <>
                            <div>
                                <label className="text-sm font-medium">Frequency</label>
                                <Dropdown
                                    value={formData.frequency}
                                    onChange={e => setFormData(p => ({ ...p, frequency: e.value }))}
                                    options={FREQUENCIES}
                                    optionLabel="label"
                                    optionValue="value"
                                    className="w-full"
                                />
                                <HelpTip text="How often this item repeats. Use 'Custom' for non-standard intervals." />
                            </div>
                            {formData.frequency === 'custom' && (
                                <div>
                                    <label className="text-sm font-medium">Interval (months)</label>
                                    <InputNumber
                                        value={formData.customIntervalMonths ? parseInt(formData.customIntervalMonths) : null}
                                        onValueChange={e => setFormData(p => ({ ...p, customIntervalMonths: e.value?.toString() || '' }))}
                                        placeholder="e.g., 3 for quarterly"
                                        className="w-full"
                                        min={1}
                                        showButtons
                                    />
                                    <HelpTip text="Number of months between each occurrence." />
                                </div>
                            )}
                        </>
                    )}

                    {/* === ONE-OFF SPECIFIC FIELDS === */}
                    {formData.recurrence === 'one-off' && (
                        <div>
                            <label className="text-sm font-medium">Scheduled Month</label>
                            <MonthPicker
                                value={formData.scheduledDate}
                                onChange={v => setFormData(p => ({ ...p, scheduledDate: v }))}
                                placeholder="When will this happen?"
                            />
                            <HelpTip text="The month this one-time item is expected to occur." />
                        </div>
                    )}

                    {/* Date range (recurring + salary) */}
                    {formData.recurrence !== 'one-off' && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">Start Month</label>
                                <MonthPicker
                                    value={formData.startDate}
                                    onChange={v => setFormData(p => ({ ...p, startDate: v }))}
                                    placeholder="First month"
                                />
                                <HelpTip text="First month this item takes effect." />
                            </div>
                            <div>
                                <label className="text-sm font-medium">End Month (opt)</label>
                                <MonthPicker
                                    value={formData.endDate}
                                    onChange={v => setFormData(p => ({ ...p, endDate: v }))}
                                    placeholder="Leave empty = ongoing"
                                />
                                <HelpTip text="Leave empty to continue indefinitely." />
                            </div>
                        </div>
                    )}

                    {/* Active toggle (recurring + salary) */}
                    {formData.recurrence !== 'one-off' && (
                        <div className="flex items-center gap-2">
                            <InputSwitch
                                checked={formData.isActive}
                                onChange={(e: InputSwitchChangeEvent) => setFormData(p => ({ ...p, isActive: e.value ?? false }))}
                            />
                            <label className="text-sm">Active</label>
                            <HelpTip text="Inactive items are paused and won't appear in projections." />
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button label="Cancel" severity="secondary" outlined onClick={handleFormClose} />
                        <Button label="Save" icon={<MdCheck />} onClick={handleSubmit} />
                    </div>
                </div>
            </Dialog>
        </>
    );
}
