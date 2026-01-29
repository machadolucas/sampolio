'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency, CURRENCIES, PLANNING_HORIZONS } from '@/lib/constants';
import type { FinancialAccount } from '@/types';

export default function AccountsPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);

    useEffect(() => {
        async function fetchAccounts() {
            try {
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
        }
        fetchAccounts();
    }, []);

    const filteredAccounts = accounts.filter(a => showArchived ? a.isArchived : !a.isArchived);

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
            }
        } catch (err) {
            console.error('Failed to delete account:', err);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Financial Accounts</h1>
                    <p className="text-gray-600">
                        Manage your financial accounts and their settings
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        label={showArchived ? 'Show Active' : 'Show Archived'}
                        severity="secondary"
                        outlined
                        size="small"
                        onClick={() => setShowArchived(!showArchived)}
                    />
                    <Button label="New Account" icon="pi pi-plus" onClick={() => router.push('/accounts/new')} />
                </div>
            </div>

            {/* Accounts Grid */}
            {filteredAccounts.length === 0 ? (
                <div className="text-center py-16">
                    <i className="pi pi-wallet text-6xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">
                        {showArchived ? 'No archived accounts' : 'No accounts yet'}
                    </h2>
                    <p className="text-gray-600 mb-6">
                        {showArchived
                            ? 'Archived accounts will appear here'
                            : 'Create your first financial account to start planning'
                        }
                    </p>
                    {!showArchived && (
                        <Button label="Create Account" icon="pi pi-plus" onClick={() => router.push('/accounts/new')} />
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredAccounts.map((account) => {
                        const currency = CURRENCIES.find(c => c.value === account.currency);
                        const horizon = PLANNING_HORIZONS.find(h => h.value === account.planningHorizonMonths);

                        return (
                            <Card key={account.id} className="relative group p-4">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                                            <i className="pi pi-wallet text-blue-600"></i>
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{account.name}</h3>
                                            <p className="text-sm text-gray-500">
                                                {currency?.label} ({currency?.symbol})
                                            </p>
                                        </div>
                                    </div>
                                    {account.isArchived && (
                                        <Tag value="Archived" severity="warning" />
                                    )}
                                </div>

                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Starting Balance</span>
                                        <span className="font-medium text-gray-900">
                                            {formatCurrency(account.startingBalance, account.currency)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Start Date</span>
                                        <span className="font-medium text-gray-900">
                                            {account.startingDate}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Planning Horizon</span>
                                        <span className="font-medium text-gray-900">
                                            {account.customEndDate || horizon?.label || `${account.planningHorizonMonths} months`}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                                    <Button
                                        label="Edit"
                                        icon="pi pi-pencil"
                                        severity="secondary"
                                        outlined
                                        size="small"
                                        className="flex-1"
                                        onClick={() => router.push(`/accounts/${account.id}`)}
                                    />
                                    <Button
                                        icon="pi pi-inbox"
                                        severity="secondary"
                                        outlined
                                        size="small"
                                        onClick={() => handleArchive(account.id, !account.isArchived)}
                                    />
                                    <Button
                                        icon="pi pi-trash"
                                        severity="danger"
                                        outlined
                                        size="small"
                                        onClick={() => handleDelete(account.id)}
                                    />
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
