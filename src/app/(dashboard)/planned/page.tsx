'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, FREQUENCIES, ITEM_CATEGORIES, formatYearMonth } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import type { FinancialAccount, PlannedItem, Currency } from '@/types';

export default function PlannedPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [items, setItems] = useState<PlannedItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PlannedItem | null>(null);
    const [filterKind, setFilterKind] = useState<'all' | 'one-off' | 'repeating'>('all');

    // Form state
    const [formData, setFormData] = useState({
        type: 'expense' as 'income' | 'expense',
        kind: 'one-off' as 'one-off' | 'repeating',
        name: '',
        amount: '',
        category: '',
        scheduledDate: getCurrentYearMonth(),
        frequency: 'yearly',
        customIntervalMonths: '12',
        firstOccurrence: getCurrentYearMonth(),
        endDate: '',
    });

    // Fetch accounts
    useEffect(() => {
        async function fetchAccounts() {
            try {
                const res = await fetch('/api/accounts');
                const data = await res.json();
                if (data.success) {
                    setAccounts(data.data.filter((a: FinancialAccount) => !a.isArchived));
                    if (data.data.length > 0 && !selectedAccountId) {
                        setSelectedAccountId(data.data[0].id);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch accounts:', err);
            } finally {
                setIsLoading(false);
            }
        }
        fetchAccounts();
    }, []);

    // Fetch items when account changes
    const fetchItems = useCallback(async () => {
        if (!selectedAccountId) return;

        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/planned`);
            const data = await res.json();
            if (data.success) {
                setItems(data.data);
            }
        } catch (err) {
            console.error('Failed to fetch planned items:', err);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const resetForm = () => {
        setFormData({
            type: 'expense',
            kind: 'one-off',
            name: '',
            amount: '',
            category: '',
            scheduledDate: getCurrentYearMonth(),
            frequency: 'yearly',
            customIntervalMonths: '12',
            firstOccurrence: getCurrentYearMonth(),
            endDate: '',
        });
        setEditingItem(null);
    };

    const openModal = (item?: PlannedItem) => {
        if (item) {
            setEditingItem(item);
            setFormData({
                type: item.type,
                kind: item.kind,
                name: item.name,
                amount: item.amount.toString(),
                category: item.category || '',
                scheduledDate: item.scheduledDate || getCurrentYearMonth(),
                frequency: item.frequency || 'yearly',
                customIntervalMonths: item.customIntervalMonths?.toString() || '12',
                firstOccurrence: item.firstOccurrence || getCurrentYearMonth(),
                endDate: item.endDate || '',
            });
        } else {
            resetForm();
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const body: Record<string, unknown> = {
                type: formData.type,
                kind: formData.kind,
                name: formData.name,
                amount: parseFloat(formData.amount),
                category: formData.category || undefined,
            };

            if (formData.kind === 'one-off') {
                body.scheduledDate = formData.scheduledDate;
            } else {
                body.frequency = formData.frequency;
                body.customIntervalMonths = formData.frequency === 'custom' ? parseInt(formData.customIntervalMonths, 10) : undefined;
                body.firstOccurrence = formData.firstOccurrence;
                body.endDate = formData.endDate || undefined;
            }

            const url = editingItem
                ? `/api/accounts/${selectedAccountId}/planned/${editingItem.id}`
                : `/api/accounts/${selectedAccountId}/planned`;

            const res = await fetch(url, {
                method: editingItem ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (data.success) {
                await fetchItems();
                setIsModalOpen(false);
                resetForm();
            }
        } catch (err) {
            console.error('Failed to save item:', err);
        }
    };

    const handleDelete = async (itemId: string) => {
        if (!confirm('Are you sure you want to delete this item?')) return;

        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/planned/${itemId}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                setItems(prev => prev.filter(i => i.id !== itemId));
            }
        } catch (err) {
            console.error('Failed to delete item:', err);
        }
    };

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const currency = (selectedAccount?.currency || 'EUR') as Currency;

    const filteredItems = items.filter(item => {
        if (filterKind === 'all') return true;
        return item.kind === filterKind;
    });

    const oneOffItems = filteredItems.filter(i => i.kind === 'one-off');
    const repeatingItems = filteredItems.filter(i => i.kind === 'repeating');

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
                <i className="pi pi-calendar text-6xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    No accounts yet
                </h2>
                <p className="text-gray-600 mb-6">
                    Create a financial account first to add planned items
                </p>
                <Button label="Create Account" onClick={() => router.push('/accounts/new')} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Planned Items</h1>
                    <p className="text-gray-600">
                        Schedule one-off or repeating income and expenses
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Dropdown
                        value={selectedAccountId}
                        onChange={(e: DropdownChangeEvent) => setSelectedAccountId(e.value)}
                        options={accounts.map(a => ({ value: a.id, label: a.name }))}
                        optionLabel="label"
                        optionValue="value"
                        className="w-48"
                    />
                    <Button label="Add Item" icon="pi pi-plus" onClick={() => openModal()} />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">One-off Items</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {items.filter(i => i.kind === 'one-off').length}
                            </p>
                        </div>
                        <i className="pi pi-calendar text-3xl text-blue-600"></i>
                    </div>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Repeating Items</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {items.filter(i => i.kind === 'repeating').length}
                            </p>
                        </div>
                        <i className="pi pi-sync text-3xl text-purple-600"></i>
                    </div>
                </Card>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
                <Button
                    label="All"
                    size="small"
                    severity={filterKind === 'all' ? undefined : 'secondary'}
                    outlined={filterKind !== 'all'}
                    onClick={() => setFilterKind('all')}
                />
                <Button
                    label="One-off"
                    size="small"
                    severity={filterKind === 'one-off' ? undefined : 'secondary'}
                    outlined={filterKind !== 'one-off'}
                    onClick={() => setFilterKind('one-off')}
                />
                <Button
                    label="Repeating"
                    size="small"
                    severity={filterKind === 'repeating' ? undefined : 'secondary'}
                    outlined={filterKind !== 'repeating'}
                    onClick={() => setFilterKind('repeating')}
                />
            </div>

            {/* Items Table */}
            <Card>
                <div className="overflow-x-auto p-4">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200">
                                <th className="text-left py-3 px-4 font-medium text-gray-500">Name</th>
                                <th className="text-left py-3 px-4 font-medium text-gray-500">Type</th>
                                <th className="text-left py-3 px-4 font-medium text-gray-500">Kind</th>
                                <th className="text-right py-3 px-4 font-medium text-gray-500">Amount</th>
                                <th className="text-left py-3 px-4 font-medium text-gray-500">Schedule</th>
                                <th className="text-right py-3 px-4 font-medium text-gray-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.map((item) => (
                                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="py-3 px-4">
                                        <div>
                                            <p className="font-medium text-gray-900">{item.name}</p>
                                            {item.category && (
                                                <p className="text-xs text-gray-500">{item.category}</p>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-3 px-4">
                                        <Tag value={item.type === 'income' ? 'Income' : 'Expense'} severity={item.type === 'income' ? 'success' : 'danger'} />
                                    </td>
                                    <td className="py-3 px-4">
                                        <Tag value={item.kind === 'one-off' ? 'One-off' : 'Repeating'} severity={item.kind === 'one-off' ? 'info' : 'secondary'} />
                                    </td>
                                    <td className={`py-3 px-4 text-right font-medium ${item.type === 'income'
                                        ? 'text-green-600'
                                        : 'text-red-600'
                                        }`}>
                                        {item.type === 'income' ? '+' : '-'}{formatCurrency(item.amount, currency)}
                                    </td>
                                    <td className="py-3 px-4 text-gray-600">
                                        {item.kind === 'one-off'
                                            ? formatYearMonth(item.scheduledDate!)
                                            : `${item.frequency === 'custom'
                                                ? `Every ${item.customIntervalMonths} months`
                                                : (item.frequency ?? 'monthly').charAt(0).toUpperCase() + (item.frequency ?? 'monthly').slice(1)
                                            } from ${formatYearMonth(item.firstOccurrence!)}`
                                        }
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                icon="pi pi-pencil"
                                                text
                                                size="small"
                                                onClick={() => openModal(item)}
                                            />
                                            <Button
                                                icon="pi pi-trash"
                                                text
                                                size="small"
                                                severity="danger"
                                                onClick={() => handleDelete(item.id)}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredItems.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center text-gray-500">
                                        No planned items yet. Click &quot;Add Item&quot; to create one.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Add/Edit Modal */}
            <Dialog
                visible={isModalOpen}
                onHide={() => {
                    setIsModalOpen(false);
                    resetForm();
                }}
                header={editingItem ? 'Edit Planned Item' : 'Add Planned Item'}
                style={{ width: '500px' }}
                footer={
                    <div className="flex justify-end gap-3">
                        <Button
                            type="button"
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => {
                                setIsModalOpen(false);
                                resetForm();
                            }}
                        />
                        <Button label={editingItem ? 'Save Changes' : 'Add Item'} onClick={handleSubmit} />
                    </div>
                }
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Kind Selection */}
                    <div className="flex gap-4">
                        <Button
                            type="button"
                            label="One-off"
                            icon="pi pi-calendar"
                            className="flex-1"
                            severity={formData.kind === 'one-off' ? undefined : 'secondary'}
                            outlined={formData.kind !== 'one-off'}
                            onClick={() => setFormData(prev => ({ ...prev, kind: 'one-off' }))}
                        />
                        <Button
                            type="button"
                            label="Repeating"
                            icon="pi pi-sync"
                            className="flex-1"
                            severity={formData.kind === 'repeating' ? undefined : 'secondary'}
                            outlined={formData.kind !== 'repeating'}
                            onClick={() => setFormData(prev => ({ ...prev, kind: 'repeating' }))}
                        />
                    </div>

                    {/* Type Selection */}
                    <div className="flex gap-4">
                        <Button
                            type="button"
                            label="Income"
                            icon="pi pi-arrow-up"
                            className="flex-1"
                            severity={formData.type === 'income' ? undefined : 'secondary'}
                            outlined={formData.type !== 'income'}
                            onClick={() => setFormData(prev => ({ ...prev, type: 'income' }))}
                        />
                        <Button
                            type="button"
                            label="Expense"
                            icon="pi pi-arrow-down"
                            className="flex-1"
                            severity={formData.type === 'expense' ? undefined : 'secondary'}
                            outlined={formData.type !== 'expense'}
                            onClick={() => setFormData(prev => ({ ...prev, type: 'expense' }))}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Name</label>
                        <InputText
                            placeholder="e.g., Annual Tax, Holiday Bonus"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Amount</label>
                        <InputText
                            type="number"
                            placeholder="0.00"
                            value={formData.amount}
                            onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Category (optional)</label>
                        <Dropdown
                            value={formData.category}
                            onChange={(e: DropdownChangeEvent) => setFormData(prev => ({ ...prev, category: e.value }))}
                            options={[{ value: '', label: 'Select category...' }, ...ITEM_CATEGORIES.map(c => ({ value: c, label: c }))]}
                            optionLabel="label"
                            optionValue="value"
                            className="w-full"
                        />
                    </div>

                    {formData.kind === 'one-off' ? (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Scheduled Date</label>
                            <InputText
                                type="month"
                                value={formData.scheduledDate}
                                onChange={(e) => setFormData(prev => ({ ...prev, scheduledDate: e.target.value }))}
                                required
                            />
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col gap-2">
                                <label className="font-medium text-sm">Frequency</label>
                                <Dropdown
                                    value={formData.frequency}
                                    onChange={(e: DropdownChangeEvent) => setFormData(prev => ({ ...prev, frequency: e.value }))}
                                    options={FREQUENCIES.filter(f => f.value !== 'monthly')}
                                    optionLabel="label"
                                    optionValue="value"
                                    className="w-full"
                                />
                            </div>

                            {formData.frequency === 'custom' && (
                                <div className="flex flex-col gap-2">
                                    <label className="font-medium text-sm">Interval (months)</label>
                                    <InputText
                                        type="number"
                                        placeholder="e.g., 6 for every 6 months"
                                        value={formData.customIntervalMonths}
                                        onChange={(e) => setFormData(prev => ({ ...prev, customIntervalMonths: e.target.value }))}
                                        required
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-2">
                                    <label className="font-medium text-sm">First Occurrence</label>
                                    <InputText
                                        type="month"
                                        value={formData.firstOccurrence}
                                        onChange={(e) => setFormData(prev => ({ ...prev, firstOccurrence: e.target.value }))}
                                        required
                                    />
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="font-medium text-sm">End Date (optional)</label>
                                    <InputText
                                        type="month"
                                        value={formData.endDate}
                                        onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </form>
            </Dialog>
        </div>
    );
}
