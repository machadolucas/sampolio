'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputSwitch, InputSwitchChangeEvent } from 'primereact/inputswitch';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, FREQUENCIES, ITEM_CATEGORIES, formatYearMonth } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import {
    getRecurringItems,
    createRecurringItem,
    updateRecurringItem,
    deleteRecurringItem,
} from '@/lib/actions/recurring';
import type { FinancialAccount, RecurringItem, Currency } from '@/types';

interface RecurringModalProps {
    visible: boolean;
    onHide: () => void;
    selectedAccountId: string;
    accounts: FinancialAccount[];
    onAccountChange: (accountId: string) => void;
    onDataChange?: () => void;
}

export function RecurringModal({
    visible,
    onHide,
    selectedAccountId,
    accounts,
    onAccountChange,
    onDataChange,
}: RecurringModalProps) {
    const [items, setItems] = useState<RecurringItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');

    const [formData, setFormData] = useState({
        type: 'income' as 'income' | 'expense',
        name: '',
        amount: '',
        category: '',
        frequency: 'monthly',
        customIntervalMonths: '1',
        startDate: getCurrentYearMonth(),
        endDate: '',
        isActive: true,
    });

    const fetchItems = useCallback(async () => {
        if (!selectedAccountId) return;
        setIsLoading(true);
        try {
            const result = await getRecurringItems(selectedAccountId);
            if (result.success && result.data) {
                setItems(result.data);
            }
        } catch (err) {
            console.error('Failed to fetch items:', err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        if (visible && selectedAccountId) {
            fetchItems();
        }
    }, [visible, selectedAccountId, fetchItems]);

    const resetForm = () => {
        setFormData({
            type: 'income',
            name: '',
            amount: '',
            category: '',
            frequency: 'monthly',
            customIntervalMonths: '1',
            startDate: getCurrentYearMonth(),
            endDate: '',
            isActive: true,
        });
        setEditingItem(null);
    };

    const openForm = (item?: RecurringItem) => {
        if (item) {
            setEditingItem(item);
            setFormData({
                type: item.type,
                name: item.name,
                amount: item.amount.toString(),
                category: item.category || '',
                frequency: item.frequency,
                customIntervalMonths: item.customIntervalMonths?.toString() || '1',
                startDate: item.startDate,
                endDate: item.endDate || '',
                isActive: item.isActive,
            });
        } else {
            resetForm();
        }
        setIsFormOpen(true);
    };

    const handleSubmit = async () => {
        try {
            const body = {
                type: formData.type,
                name: formData.name,
                amount: parseFloat(formData.amount),
                category: formData.category || undefined,
                frequency: formData.frequency as 'monthly' | 'quarterly' | 'yearly' | 'custom',
                customIntervalMonths: formData.frequency === 'custom' ? parseInt(formData.customIntervalMonths, 10) : undefined,
                startDate: formData.startDate,
                endDate: formData.endDate || undefined,
                isActive: formData.isActive,
            };

            const result = editingItem
                ? await updateRecurringItem(selectedAccountId, editingItem.id, body)
                : await createRecurringItem(selectedAccountId, body);

            if (result.success) {
                await fetchItems();
                setIsFormOpen(false);
                resetForm();
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to save:', err);
        }
    };

    const handleDelete = async (itemId: string) => {
        if (!confirm('Delete this item?')) return;
        try {
            const result = await deleteRecurringItem(selectedAccountId, itemId);
            if (result.success) {
                setItems(prev => prev.filter(i => i.id !== itemId));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete:', err);
        }
    };

    const handleToggle = async (item: RecurringItem) => {
        try {
            const result = await updateRecurringItem(selectedAccountId, item.id, { isActive: !item.isActive });
            if (result.success) {
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, isActive: !i.isActive } : i));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to toggle:', err);
        }
    };

    const account = accounts.find(a => a.id === selectedAccountId);
    const currency = (account?.currency || 'EUR') as Currency;
    const filtered = items.filter(i => filterType === 'all' || i.type === filterType);
    const totalIncome = items.filter(i => i.type === 'income' && i.isActive).reduce((s, i) => s + i.amount, 0);
    const totalExpenses = items.filter(i => i.type === 'expense' && i.isActive).reduce((s, i) => s + i.amount, 0);

    return (
        <Dialog
            header="Recurring Items"
            visible={visible}
            onHide={onHide}
            style={{ width: '95vw', maxWidth: '1400px' }}
            maximizable
            modal
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
                            {(['all', 'income', 'expense'] as const).map(type => (
                                <Button
                                    key={type}
                                    label={type.charAt(0).toUpperCase() + type.slice(1)}
                                    size="small"
                                    severity={filterType === type ? undefined : 'secondary'}
                                    outlined={filterType !== type}
                                    onClick={() => setFilterType(type)}
                                />
                            ))}
                        </div>
                    </div>
                    <Button label="Add Item" icon="pi pi-plus" onClick={() => openForm()} />
                </div>

                {/* Summary */}
                <div className="grid grid-cols-3 gap-4">
                    <Card className="p-3">
                        <div className="text-center">
                            <p className="text-sm text-gray-500">Monthly Income</p>
                            <p className="text-xl font-bold text-green-600">{formatCurrency(totalIncome, currency)}</p>
                        </div>
                    </Card>
                    <Card className="p-3">
                        <div className="text-center">
                            <p className="text-sm text-gray-500">Monthly Expenses</p>
                            <p className="text-xl font-bold text-red-600">{formatCurrency(totalExpenses, currency)}</p>
                        </div>
                    </Card>
                    <Card className="p-3">
                        <div className="text-center">
                            <p className="text-sm text-gray-500">Net Monthly</p>
                            <p className={`text-xl font-bold ${totalIncome - totalExpenses >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(totalIncome - totalExpenses, currency)}
                            </p>
                        </div>
                    </Card>
                </div>

                {/* Items */}
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <ProgressSpinner style={{ width: '40px', height: '40px' }} />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No items yet. Click &quot;Add Item&quot; to create one.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 px-3">Name</th>
                                    <th className="text-left py-2 px-3">Type</th>
                                    <th className="text-right py-2 px-3">Amount</th>
                                    <th className="text-left py-2 px-3">Frequency</th>
                                    <th className="text-left py-2 px-3">Period</th>
                                    <th className="text-center py-2 px-3">Status</th>
                                    <th className="text-right py-2 px-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(item => (
                                    <tr key={item.id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                                        <td className="py-2 px-3">
                                            <div>
                                                <p className="font-medium">{item.name}</p>
                                                {item.category && <p className="text-xs text-gray-500">{item.category}</p>}
                                            </div>
                                        </td>
                                        <td className="py-2 px-3">
                                            <Tag value={item.type} severity={item.type === 'income' ? 'success' : 'danger'} />
                                        </td>
                                        <td className={`py-2 px-3 text-right font-medium ${item.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                                            {item.type === 'income' ? '+' : '-'}{formatCurrency(item.amount, currency)}
                                        </td>
                                        <td className="py-2 px-3">{item.frequency}</td>
                                        <td className="py-2 px-3 text-gray-600">
                                            {formatYearMonth(item.startDate)} - {item.endDate ? formatYearMonth(item.endDate) : 'Ongoing'}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            <Tag value={item.isActive ? 'Active' : 'Inactive'} severity={item.isActive ? 'success' : 'secondary'} />
                                        </td>
                                        <td className="py-2 px-3">
                                            <div className="flex justify-end gap-1">
                                                <Button icon={item.isActive ? 'pi pi-check-circle' : 'pi pi-circle'} text size="small" onClick={() => handleToggle(item)} />
                                                <Button icon="pi pi-pencil" text size="small" onClick={() => openForm(item)} />
                                                <Button icon="pi pi-trash" text size="small" severity="danger" onClick={() => handleDelete(item.id)} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Form Dialog */}
            <Dialog
                header={editingItem ? 'Edit Item' : 'Add Item'}
                visible={isFormOpen}
                onHide={() => { setIsFormOpen(false); resetForm(); }}
                style={{ width: '450px' }}
            >
                <div className="space-y-4">
                    <div className="flex gap-2">
                        <Button type="button" label="Income" icon="pi pi-arrow-up" className="flex-1"
                            severity={formData.type === 'income' ? undefined : 'secondary'}
                            outlined={formData.type !== 'income'}
                            onClick={() => setFormData(p => ({ ...p, type: 'income' }))} />
                        <Button type="button" label="Expense" icon="pi pi-arrow-down" className="flex-1"
                            severity={formData.type === 'expense' ? undefined : 'secondary'}
                            outlined={formData.type !== 'expense'}
                            onClick={() => setFormData(p => ({ ...p, type: 'expense' }))} />
                    </div>
                    <div><label className="text-sm font-medium">Name</label>
                        <InputText value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full" /></div>
                    <div><label className="text-sm font-medium">Amount</label>
                        <InputText type="number" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} className="w-full" /></div>
                    <div><label className="text-sm font-medium">Category</label>
                        <Dropdown value={formData.category} onChange={e => setFormData(p => ({ ...p, category: e.value }))}
                            options={[{ value: '', label: 'None' }, ...ITEM_CATEGORIES.map(c => ({ value: c, label: c }))]}
                            optionLabel="label" optionValue="value" className="w-full" /></div>
                    <div><label className="text-sm font-medium">Frequency</label>
                        <Dropdown value={formData.frequency} onChange={e => setFormData(p => ({ ...p, frequency: e.value }))}
                            options={FREQUENCIES} optionLabel="label" optionValue="value" className="w-full" /></div>
                    {formData.frequency === 'custom' && (
                        <div><label className="text-sm font-medium">Interval (months)</label>
                            <InputText type="number" value={formData.customIntervalMonths}
                                onChange={e => setFormData(p => ({ ...p, customIntervalMonths: e.target.value }))} className="w-full" /></div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-sm font-medium">Start</label>
                            <InputText type="month" value={formData.startDate} onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))} className="w-full" /></div>
                        <div><label className="text-sm font-medium">End (opt)</label>
                            <InputText type="month" value={formData.endDate} onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} className="w-full" /></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <InputSwitch checked={formData.isActive} onChange={(e: InputSwitchChangeEvent) => setFormData(p => ({ ...p, isActive: e.value ?? false }))} />
                        <label className="text-sm">Active</label>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button label="Cancel" severity="secondary" outlined onClick={() => { setIsFormOpen(false); resetForm(); }} />
                        <Button label="Save" onClick={handleSubmit} />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
