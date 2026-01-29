'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { formatCurrency, CURRENCIES, PLANNING_HORIZONS } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import type { FinancialAccount } from '@/types';

interface AccountsModalContentProps {
    visible: boolean;
    onHide: () => void;
    onAccountChange?: () => void;
    selectedAccountId?: string;
    onSelectAccount?: (accountId: string) => void;
}

export function AccountsModalContent({
    visible,
    onHide,
    onAccountChange,
    selectedAccountId,
    onSelectAccount,
}: AccountsModalContentProps) {
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(null);
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [name, setName] = useState('');
    const [currency, setCurrency] = useState('EUR');
    const [startingBalance, setStartingBalance] = useState<number>(0);
    const [startingDate, setStartingDate] = useState(getCurrentYearMonth());
    const [planningHorizonMonths, setPlanningHorizonMonths] = useState(36);
    const [customEndDate, setCustomEndDate] = useState('');

    const fetchAccounts = useCallback(async () => {
        try {
            setIsLoading(true);
            const res = await fetch('/api/accounts');
            const data = await res.json();
            if (data.success) {
                setAccounts(data.data);
            }
        } catch (err) {
            console.error('Failed to fetch accounts:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) {
            fetchAccounts();
        }
    }, [visible, fetchAccounts]);

    const filteredAccounts = accounts.filter(a => showArchived ? a.isArchived : !a.isArchived);

    const resetForm = () => {
        setName('');
        setCurrency('EUR');
        setStartingBalance(0);
        setStartingDate(getCurrentYearMonth());
        setPlanningHorizonMonths(36);
        setCustomEndDate('');
        setError('');
        setEditingAccount(null);
    };

    const openForm = (account?: FinancialAccount) => {
        if (account) {
            setEditingAccount(account);
            setName(account.name);
            setCurrency(account.currency);
            setStartingBalance(account.startingBalance);
            setStartingDate(account.startingDate);
            setPlanningHorizonMonths(account.planningHorizonMonths);
            setCustomEndDate(account.customEndDate || '');
        } else {
            resetForm();
        }
        setIsFormOpen(true);
    };

    const handleSubmit = async () => {
        setError('');
        setIsSaving(true);

        try {
            const payload = {
                name,
                currency,
                startingBalance,
                startingDate,
                planningHorizonMonths,
                customEndDate: planningHorizonMonths === -1 ? customEndDate : undefined,
            };

            const url = editingAccount
                ? `/api/accounts/${editingAccount.id}`
                : '/api/accounts';

            const res = await fetch(url, {
                method: editingAccount ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!data.success) {
                setError(data.error || 'Failed to save account');
                return;
            }

            setIsFormOpen(false);
            resetForm();
            await fetchAccounts();
            onAccountChange?.();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleArchive = async (accountId: string, archive: boolean) => {
        try {
            const res = await fetch(`/api/accounts/${accountId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isArchived: archive }),
            });
            const data = await res.json();
            if (data.success) {
                setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, isArchived: archive } : a));
                onAccountChange?.();
            }
        } catch (err) {
            console.error('Failed to archive account:', err);
        }
    };

    const handleDelete = async (accountId: string) => {
        if (!confirm('Are you sure you want to delete this account? This action cannot be undone.')) {
            return;
        }

        try {
            const res = await fetch(`/api/accounts/${accountId}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                setAccounts(prev => prev.filter(a => a.id !== accountId));
                onAccountChange?.();
            }
        } catch (err) {
            console.error('Failed to delete account:', err);
        }
    };

    return (
        <Dialog
            header="Financial Accounts"
            visible={visible}
            onHide={onHide}
            style={{ width: '90vw', maxWidth: '1200px' }}
            maximizable
            modal
        >
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <ProgressSpinner style={{ width: '50px', height: '50px' }} />
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Header Actions */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Button
                                label={showArchived ? 'Show Active' : 'Show Archived'}
                                severity="secondary"
                                outlined
                                size="small"
                                onClick={() => setShowArchived(!showArchived)}
                            />
                        </div>
                        <Button
                            label="New Account"
                            icon="pi pi-plus"
                            onClick={() => openForm()}
                        />
                    </div>

                    {/* Accounts Grid */}
                    {filteredAccounts.length === 0 ? (
                        <div className="text-center py-12">
                            <i className="pi pi-wallet text-5xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                            <h3 className="text-lg font-semibold mb-2">
                                {showArchived ? 'No archived accounts' : 'No accounts yet'}
                            </h3>
                            <p className="text-gray-500 mb-4">
                                {showArchived
                                    ? 'Archived accounts will appear here'
                                    : 'Create your first financial account to start planning'
                                }
                            </p>
                            {!showArchived && (
                                <Button
                                    label="Create Account"
                                    icon="pi pi-plus"
                                    onClick={() => openForm()}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredAccounts.map((account) => {
                                const currencyInfo = CURRENCIES.find(c => c.value === account.currency);
                                const horizon = PLANNING_HORIZONS.find(h => h.value === account.planningHorizonMonths);
                                const isSelected = selectedAccountId === account.id;

                                return (
                                    <Card
                                        key={account.id}
                                        className={`relative group cursor-pointer transition-all ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                                        onClick={() => onSelectAccount?.(account.id)}
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                                                        <i className="pi pi-wallet text-blue-600 text-sm"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold text-sm">{account.name}</h4>
                                                        <p className="text-xs text-gray-500">
                                                            {currencyInfo?.symbol}
                                                        </p>
                                                    </div>
                                                </div>
                                                {account.isArchived && <Tag value="Archived" severity="warning" className="text-xs" />}
                                                {isSelected && !account.isArchived && <Tag value="Active" severity="success" className="text-xs" />}
                                            </div>

                                            <div className="space-y-1 text-xs mb-3">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Balance</span>
                                                    <span className="font-medium">
                                                        {formatCurrency(account.startingBalance, account.currency)}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Horizon</span>
                                                    <span className="font-medium">
                                                        {horizon?.label || `${account.planningHorizonMonths} mo.`}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex gap-1 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    icon="pi pi-pencil"
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip="Edit"
                                                    onClick={() => openForm(account)}
                                                />
                                                <Button
                                                    icon={account.isArchived ? 'pi pi-replay' : 'pi pi-inbox'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={account.isArchived ? 'Restore' : 'Archive'}
                                                    onClick={() => handleArchive(account.id, !account.isArchived)}
                                                />
                                                <Button
                                                    icon="pi pi-trash"
                                                    severity="danger"
                                                    text
                                                    size="small"
                                                    tooltip="Delete"
                                                    onClick={() => handleDelete(account.id)}
                                                />
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Add/Edit Account Dialog */}
            <Dialog
                header={editingAccount ? 'Edit Account' : 'New Account'}
                visible={isFormOpen}
                onHide={() => {
                    setIsFormOpen(false);
                    resetForm();
                }}
                style={{ width: '500px' }}
                modal
            >
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Account Name</label>
                        <InputText
                            placeholder="e.g., Main Account, Savings"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Currency</label>
                        <Dropdown
                            value={currency}
                            onChange={(e: DropdownChangeEvent) => setCurrency(e.value)}
                            options={CURRENCIES}
                            optionLabel="label"
                            optionValue="value"
                            placeholder="Select Currency"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Starting Balance</label>
                        <InputNumber
                            value={startingBalance}
                            onValueChange={(e) => setStartingBalance(e.value || 0)}
                            mode="currency"
                            currency={currency}
                            locale="en-US"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Starting Date (YYYY-MM)</label>
                        <InputText
                            value={startingDate}
                            onChange={(e) => setStartingDate(e.target.value)}
                            placeholder="2026-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Planning Horizon</label>
                        <Dropdown
                            value={planningHorizonMonths}
                            onChange={(e: DropdownChangeEvent) => setPlanningHorizonMonths(e.value)}
                            options={PLANNING_HORIZONS}
                            optionLabel="label"
                            optionValue="value"
                            placeholder="Select Horizon"
                        />
                    </div>

                    {planningHorizonMonths === -1 && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Custom End Date (YYYY-MM)</label>
                            <InputText
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                placeholder="2030-12"
                            />
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-4">
                        <Button
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => {
                                setIsFormOpen(false);
                                resetForm();
                            }}
                        />
                        <Button
                            label={editingAccount ? 'Save Changes' : 'Create Account'}
                            loading={isSaving}
                            onClick={handleSubmit}
                        />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
