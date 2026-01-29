'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, FREQUENCIES, ITEM_CATEGORIES, formatYearMonth } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import type { FinancialAccount, PlannedItem, Currency } from '@/types';

interface PlannedModalProps {
    visible: boolean;
    onHide: () => void;
    selectedAccountId: string;
    accounts: FinancialAccount[];
    onAccountChange: (accountId: string) => void;
    onDataChange?: () => void;
}

export function PlannedModal({
    visible,
    onHide,
    selectedAccountId,
    accounts,
    onAccountChange,
    onDataChange,
}: PlannedModalProps) {
    const [items, setItems] = useState<PlannedItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PlannedItem | null>(null);
    const [filterKind, setFilterKind] = useState<'all' | 'one-off' | 'repeating'>('all');

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

    const fetchItems = useCallback(async () => {
        if (!selectedAccountId) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/planned`);
            const data = await res.json();
            if (data.success) setItems(data.data);
        } catch (err) {
            console.error('Failed to fetch:', err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        if (visible && selectedAccountId) fetchItems();
    }, [visible, selectedAccountId, fetchItems]);

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

    const openForm = (item?: PlannedItem) => {
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
        setIsFormOpen(true);
    };

    const handleSubmit = async () => {
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

            if (res.ok) {
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
            const res = await fetch(`/api/accounts/${selectedAccountId}/planned/${itemId}`, { method: 'DELETE' });
            if (res.ok) {
                setItems(prev => prev.filter(i => i.id !== itemId));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete:', err);
        }
    };

    const account = accounts.find(a => a.id === selectedAccountId);
    const currency = (account?.currency || 'EUR') as Currency;
    const filtered = items.filter(i => filterKind === 'all' || i.kind === filterKind);

    return (
        <Dialog
            header="Planned Items"
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
                            {(['all', 'one-off', 'repeating'] as const).map(kind => (
                                <Button
                                    key={kind}
                                    label={kind === 'one-off' ? 'One-off' : kind === 'repeating' ? 'Repeating' : 'All'}
                                    size="small"
                                    severity={filterKind === kind ? undefined : 'secondary'}
                                    outlined={filterKind !== kind}
                                    onClick={() => setFilterKind(kind)}
                                />
                            ))}
                        </div>
                    </div>
                    <Button label="Add Item" icon="pi pi-plus" onClick={() => openForm()} />
                </div>

                {/* Summary */}
                <div className="grid grid-cols-2 gap-4">
                    <Card className="p-3">
                        <div className="text-center">
                            <p className="text-sm text-gray-500">One-off Items</p>
                            <p className="text-xl font-bold">{items.filter(i => i.kind === 'one-off').length}</p>
                        </div>
                    </Card>
                    <Card className="p-3">
                        <div className="text-center">
                            <p className="text-sm text-gray-500">Repeating Items</p>
                            <p className="text-xl font-bold">{items.filter(i => i.kind === 'repeating').length}</p>
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
                                    <th className="text-left py-2 px-3">Kind</th>
                                    <th className="text-right py-2 px-3">Amount</th>
                                    <th className="text-left py-2 px-3">Schedule</th>
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
                                        <td className="py-2 px-3">
                                            <Tag value={item.kind} severity={item.kind === 'one-off' ? 'info' : 'warning'} />
                                        </td>
                                        <td className={`py-2 px-3 text-right font-medium ${item.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                                            {item.type === 'income' ? '+' : '-'}{formatCurrency(item.amount, currency)}
                                        </td>
                                        <td className="py-2 px-3 text-gray-600">
                                            {item.kind === 'one-off'
                                                ? formatYearMonth(item.scheduledDate || '')
                                                : `${item.frequency} from ${formatYearMonth(item.firstOccurrence || '')}`
                                            }
                                        </td>
                                        <td className="py-2 px-3">
                                            <div className="flex justify-end gap-1">
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
                    <div className="flex gap-2">
                        <Button type="button" label="One-off" className="flex-1"
                            severity={formData.kind === 'one-off' ? undefined : 'secondary'}
                            outlined={formData.kind !== 'one-off'}
                            onClick={() => setFormData(p => ({ ...p, kind: 'one-off' }))} />
                        <Button type="button" label="Repeating" className="flex-1"
                            severity={formData.kind === 'repeating' ? undefined : 'secondary'}
                            outlined={formData.kind !== 'repeating'}
                            onClick={() => setFormData(p => ({ ...p, kind: 'repeating' }))} />
                    </div>
                    <div><label className="text-sm font-medium">Name</label>
                        <InputText value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full" /></div>
                    <div><label className="text-sm font-medium">Amount</label>
                        <InputText type="number" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} className="w-full" /></div>
                    <div><label className="text-sm font-medium">Category</label>
                        <Dropdown value={formData.category} onChange={e => setFormData(p => ({ ...p, category: e.value }))}
                            options={[{ value: '', label: 'None' }, ...ITEM_CATEGORIES.map(c => ({ value: c, label: c }))]}
                            optionLabel="label" optionValue="value" className="w-full" /></div>

                    {formData.kind === 'one-off' ? (
                        <div><label className="text-sm font-medium">Scheduled Date</label>
                            <InputText type="month" value={formData.scheduledDate}
                                onChange={e => setFormData(p => ({ ...p, scheduledDate: e.target.value }))} className="w-full" /></div>
                    ) : (
                        <>
                            <div><label className="text-sm font-medium">Frequency</label>
                                <Dropdown value={formData.frequency} onChange={e => setFormData(p => ({ ...p, frequency: e.value }))}
                                    options={FREQUENCIES} optionLabel="label" optionValue="value" className="w-full" /></div>
                            {formData.frequency === 'custom' && (
                                <div><label className="text-sm font-medium">Interval (months)</label>
                                    <InputText type="number" value={formData.customIntervalMonths}
                                        onChange={e => setFormData(p => ({ ...p, customIntervalMonths: e.target.value }))} className="w-full" /></div>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="text-sm font-medium">First</label>
                                    <InputText type="month" value={formData.firstOccurrence}
                                        onChange={e => setFormData(p => ({ ...p, firstOccurrence: e.target.value }))} className="w-full" /></div>
                                <div><label className="text-sm font-medium">End (opt)</label>
                                    <InputText type="month" value={formData.endDate}
                                        onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} className="w-full" /></div>
                            </div>
                        </>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Button label="Cancel" severity="secondary" outlined onClick={() => { setIsFormOpen(false); resetForm(); }} />
                        <Button label="Save" onClick={handleSubmit} />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
