'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputSwitch, InputSwitchChangeEvent } from 'primereact/inputswitch';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, FREQUENCIES, ITEM_CATEGORIES, formatYearMonth } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import type { FinancialAccount, RecurringItem, Currency } from '@/types';

export default function RecurringPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [items, setItems] = useState<RecurringItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');

    // Form state
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
            const res = await fetch(`/api/accounts/${selectedAccountId}/recurring`);
            const data = await res.json();
            if (data.success) {
                setItems(data.data);
            }
        } catch (err) {
            console.error('Failed to fetch recurring items:', err);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

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

    const openModal = (item?: RecurringItem) => {
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
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const body = {
                type: formData.type,
                name: formData.name,
                amount: parseFloat(formData.amount),
                category: formData.category || undefined,
                frequency: formData.frequency,
                customIntervalMonths: formData.frequency === 'custom' ? parseInt(formData.customIntervalMonths, 10) : undefined,
                startDate: formData.startDate,
                endDate: formData.endDate || undefined,
                isActive: formData.isActive,
            };

            const url = editingItem
                ? `/api/accounts/${selectedAccountId}/recurring/${editingItem.id}`
                : `/api/accounts/${selectedAccountId}/recurring`;

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
            const res = await fetch(`/api/accounts/${selectedAccountId}/recurring/${itemId}`, {
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

    const handleToggleActive = async (item: RecurringItem) => {
        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/recurring/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !item.isActive }),
            });
            const data = await res.json();
            if (data.success) {
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, isActive: !i.isActive } : i));
            }
        } catch (err) {
            console.error('Failed to toggle item:', err);
        }
    };

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const currency = (selectedAccount?.currency || 'EUR') as Currency;

    const filteredItems = items.filter(item => {
        if (filterType === 'all') return true;
        return item.type === filterType;
    });

    const incomeItems = filteredItems.filter(i => i.type === 'income');
    const expenseItems = filteredItems.filter(i => i.type === 'expense');

    const totalIncome = incomeItems.filter(i => i.isActive).reduce((sum, i) => sum + i.amount, 0);
    const totalExpenses = expenseItems.filter(i => i.isActive).reduce((sum, i) => sum + i.amount, 0);

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
                <i className="pi pi-arrow-right-arrow-left text-6xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    No accounts yet
                </h2>
                <p className="text-gray-600 mb-6">
                    Create a financial account first to add recurring items
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
                    <h1 className="text-2xl font-bold text-gray-900">Recurring Items</h1>
                    <p className="text-gray-600">
                        Manage your recurring income and fixed expenses
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Monthly Income</p>
                            <p className="text-2xl font-bold text-green-600">
                                {formatCurrency(totalIncome, currency)}
                            </p>
                        </div>
                        <i className="pi pi-arrow-up text-3xl text-green-600"></i>
                    </div>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Monthly Expenses</p>
                            <p className="text-2xl font-bold text-red-600">
                                {formatCurrency(totalExpenses, currency)}
                            </p>
                        </div>
                        <i className="pi pi-arrow-down text-3xl text-red-600"></i>
                    </div>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Net Monthly</p>
                            <p className={`text-2xl font-bold ${totalIncome - totalExpenses >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                                }`}>
                                {formatCurrency(totalIncome - totalExpenses, currency)}
                            </p>
                        </div>
                        <i className="pi pi-arrow-right-arrow-left text-3xl text-gray-400"></i>
                    </div>
                </Card>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
                <Button
                    label="All"
                    size="small"
                    severity={filterType === 'all' ? undefined : 'secondary'}
                    outlined={filterType !== 'all'}
                    onClick={() => setFilterType('all')}
                />
                <Button
                    label="Income"
                    size="small"
                    severity={filterType === 'income' ? undefined : 'secondary'}
                    outlined={filterType !== 'income'}
                    onClick={() => setFilterType('income')}
                />
                <Button
                    label="Expenses"
                    size="small"
                    severity={filterType === 'expense' ? undefined : 'secondary'}
                    outlined={filterType !== 'expense'}
                    onClick={() => setFilterType('expense')}
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
                                <th className="text-right py-3 px-4 font-medium text-gray-500">Amount</th>
                                <th className="text-left py-3 px-4 font-medium text-gray-500">Frequency</th>
                                <th className="text-left py-3 px-4 font-medium text-gray-500">Period</th>
                                <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
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
                                    <td className={`py-3 px-4 text-right font-medium ${item.type === 'income'
                                        ? 'text-green-600'
                                        : 'text-red-600'
                                        }`}>
                                        {item.type === 'income' ? '+' : '-'}{formatCurrency(item.amount, currency)}
                                    </td>
                                    <td className="py-3 px-4 text-gray-600">
                                        {item.frequency === 'custom'
                                            ? `Every ${item.customIntervalMonths} months`
                                            : item.frequency.charAt(0).toUpperCase() + item.frequency.slice(1)
                                        }
                                    </td>
                                    <td className="py-3 px-4 text-gray-600">
                                        {formatYearMonth(item.startDate)}
                                        {item.endDate ? ` - ${formatYearMonth(item.endDate)}` : ' - Ongoing'}
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                        <Tag value={item.isActive ? 'Active' : 'Inactive'} severity={item.isActive ? 'success' : 'secondary'} />
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                icon={item.isActive ? 'pi pi-check-circle' : 'pi pi-circle'}
                                                text
                                                size="small"
                                                onClick={() => handleToggleActive(item)}
                                                className={item.isActive ? 'text-green-600' : 'text-gray-400'}
                                            />
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
                                    <td colSpan={7} className="py-8 text-center text-gray-500">
                                        No recurring items yet. Click &quot;Add Item&quot; to create one.
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
                header={editingItem ? 'Edit Recurring Item' : 'Add Recurring Item'}
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
                            placeholder="e.g., Salary, Rent, Netflix"
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

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Frequency</label>
                        <Dropdown
                            value={formData.frequency}
                            onChange={(e: DropdownChangeEvent) => setFormData(prev => ({ ...prev, frequency: e.value }))}
                            options={FREQUENCIES}
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
                                placeholder="e.g., 2 for every 2 months"
                                value={formData.customIntervalMonths}
                                onChange={(e) => setFormData(prev => ({ ...prev, customIntervalMonths: e.target.value }))}
                                required
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Start Date</label>
                            <InputText
                                type="month"
                                value={formData.startDate}
                                onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
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

                    <div className="flex items-center gap-3">
                        <InputSwitch
                            checked={formData.isActive}
                            onChange={(e: InputSwitchChangeEvent) => setFormData(prev => ({ ...prev, isActive: e.value ?? false }))}
                        />
                        <label className="font-medium text-sm">Active</label>
                    </div>
                </form>
            </Dialog>
        </div>
    );
}
