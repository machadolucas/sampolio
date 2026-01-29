'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { ProgressSpinner } from 'primereact/progressspinner';
import { CURRENCIES, PLANNING_HORIZONS } from '@/lib/constants';
import type { FinancialAccount } from '@/types';

export default function EditAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
    const { accountId } = use(params);
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const [name, setName] = useState('');
    const [currency, setCurrency] = useState('EUR');
    const [startingBalance, setStartingBalance] = useState('0');
    const [startingDate, setStartingDate] = useState('');
    const [planningHorizonMonths, setPlanningHorizonMonths] = useState('36');
    const [customEndDate, setCustomEndDate] = useState('');

    useEffect(() => {
        async function fetchAccount() {
            try {
                const res = await fetch(`/api/accounts/${accountId}`);
                const data = await res.json();

                if (data.success && data.data) {
                    const account: FinancialAccount = data.data;
                    setName(account.name);
                    setCurrency(account.currency);
                    setStartingBalance(account.startingBalance.toString());
                    setStartingDate(account.startingDate);
                    setPlanningHorizonMonths(
                        account.customEndDate ? '-1' : account.planningHorizonMonths.toString()
                    );
                    setCustomEndDate(account.customEndDate || '');
                } else {
                    setError('Account not found');
                }
            } catch {
                setError('Failed to load account');
            } finally {
                setIsLoading(false);
            }
        }

        fetchAccount();
    }, [accountId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSaving(true);

        try {
            const res = await fetch(`/api/accounts/${accountId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    currency,
                    startingBalance: parseFloat(startingBalance) || 0,
                    startingDate,
                    planningHorizonMonths: planningHorizonMonths === '-1' ? 120 : parseInt(planningHorizonMonths, 10),
                    customEndDate: planningHorizonMonths === '-1' ? customEndDate : null,
                }),
            });

            const data = await res.json();

            if (!data.success) {
                setError(data.error || 'Failed to update account');
                return;
            }

            router.push('/accounts');
            router.refresh();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
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
        <div className="max-w-2xl mx-auto">
            <Card title="Edit Financial Account">
                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <Message severity="error" text={error} className="w-full" />
                    )}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Account Name</label>
                        <InputText
                            placeholder="e.g., Finland, Brazil, Main Account"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Currency</label>
                        <Dropdown
                            value={currency}
                            onChange={(e: DropdownChangeEvent) => setCurrency(e.value)}
                            options={CURRENCIES.map(c => ({ value: c.value, label: `${c.label} (${c.symbol})` }))}
                            optionLabel="label"
                            optionValue="value"
                            className="w-full"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Starting Balance</label>
                        <InputText
                            type="number"
                            placeholder="0.00"
                            value={startingBalance}
                            onChange={(e) => setStartingBalance(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Starting Date</label>
                        <InputText
                            type="month"
                            value={startingDate}
                            onChange={(e) => setStartingDate(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Planning Horizon</label>
                        <Dropdown
                            value={planningHorizonMonths}
                            onChange={(e: DropdownChangeEvent) => setPlanningHorizonMonths(e.value)}
                            options={PLANNING_HORIZONS.map(h => ({ value: h.value, label: h.label }))}
                            optionLabel="label"
                            optionValue="value"
                            className="w-full"
                        />
                    </div>

                    {planningHorizonMonths === '-1' && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Custom End Date</label>
                            <InputText
                                type="month"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                required
                            />
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            type="button"
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => router.back()}
                        />
                        <Button type="submit" label="Save Changes" loading={isSaving} />
                    </div>
                </form>
            </Card>
        </div>
    );
}
