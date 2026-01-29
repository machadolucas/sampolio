'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { CURRENCIES, PLANNING_HORIZONS } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';

export default function NewAccountPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const [name, setName] = useState('');
    const [currency, setCurrency] = useState('EUR');
    const [startingBalance, setStartingBalance] = useState('0');
    const [startingDate, setStartingDate] = useState(getCurrentYearMonth());
    const [planningHorizonMonths, setPlanningHorizonMonths] = useState('36');
    const [customEndDate, setCustomEndDate] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const res = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    currency,
                    startingBalance: parseFloat(startingBalance) || 0,
                    startingDate,
                    planningHorizonMonths: parseInt(planningHorizonMonths, 10),
                    customEndDate: planningHorizonMonths === '-1' ? customEndDate : undefined,
                }),
            });

            const data = await res.json();

            if (!data.success) {
                setError(data.error || 'Failed to create account');
                return;
            }

            router.push('/accounts');
            router.refresh();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto">
            <Card title="Create New Financial Account">
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
                        <Button type="submit" label="Create Account" loading={isLoading} />
                    </div>
                </form>
            </Card>
        </div>
    );
}
