'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { formatCurrency, CURRENCIES } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import {
    getReceivables,
    createReceivable,
    updateReceivable,
    deleteReceivable,
    getRepayments,
    createRepayment,
    deleteRepayment,
} from '@/lib/actions/receivables';
import type { Receivable, ReceivableRepayment, Currency } from '@/types';

interface ReceivablesModalContentProps {
    visible: boolean;
    onHide: () => void;
    onDataChange?: () => void;
}

export function ReceivablesModalContent({
    visible,
    onHide,
    onDataChange,
}: ReceivablesModalContentProps) {
    const [receivables, setReceivables] = useState<Receivable[]>([]);
    const [repayments, setRepayments] = useState<Map<string, ReceivableRepayment[]>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingReceivable, setEditingReceivable] = useState<Receivable | null>(null);
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Form state for receivable
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [currency, setCurrency] = useState<Currency>('EUR');
    const [initialPrincipal, setInitialPrincipal] = useState<number>(0);
    const [startDate, setStartDate] = useState(getCurrentYearMonth());
    const [expectedMonthlyRepayment, setExpectedMonthlyRepayment] = useState<number>(0);
    const [hasInterest, setHasInterest] = useState(false);
    const [annualInterestRate, setAnnualInterestRate] = useState<number>(0);

    // Repayment form state
    const [isRepaymentFormOpen, setIsRepaymentFormOpen] = useState(false);
    const [selectedReceivableId, setSelectedReceivableId] = useState<string | null>(null);
    const [repaymentDate, setRepaymentDate] = useState(getCurrentYearMonth());
    const [repaymentAmount, setRepaymentAmount] = useState<number>(0);
    const [repaymentDescription, setRepaymentDescription] = useState('');

    // Expanded card for viewing repayments
    const [expandedReceivableId, setExpandedReceivableId] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const result = await getReceivables();
            if (result.success && result.data) {
                setReceivables(result.data);
                // Fetch repayments for each receivable
                const repaymentsMap = new Map<string, ReceivableRepayment[]>();
                for (const rec of result.data) {
                    const repaymentsResult = await getRepayments(rec.id);
                    if (repaymentsResult.success && repaymentsResult.data) {
                        repaymentsMap.set(rec.id, repaymentsResult.data);
                    }
                }
                setRepayments(repaymentsMap);
            }
        } catch (err) {
            console.error('Failed to fetch receivables:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) {
            fetchData();
        }
    }, [visible, fetchData]);

    const filteredReceivables = receivables.filter(r => showArchived ? r.isArchived : !r.isArchived);

    const resetForm = () => {
        setName('');
        setDescription('');
        setCurrency('EUR');
        setInitialPrincipal(0);
        setStartDate(getCurrentYearMonth());
        setExpectedMonthlyRepayment(0);
        setHasInterest(false);
        setAnnualInterestRate(0);
        setError('');
        setEditingReceivable(null);
    };

    const openForm = (receivable?: Receivable) => {
        if (receivable) {
            setEditingReceivable(receivable);
            setName(receivable.name);
            setDescription(receivable.description || '');
            setCurrency(receivable.currency);
            setInitialPrincipal(receivable.initialPrincipal);
            setStartDate(receivable.startDate);
            setExpectedMonthlyRepayment(receivable.expectedMonthlyRepayment || 0);
            setHasInterest(receivable.hasInterest);
            setAnnualInterestRate(receivable.annualInterestRate || 0);
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
                description: description || undefined,
                currency,
                initialPrincipal,
                startDate,
                expectedMonthlyRepayment: expectedMonthlyRepayment || undefined,
                hasInterest,
                annualInterestRate: hasInterest ? annualInterestRate : undefined,
            };

            const result = editingReceivable
                ? await updateReceivable(editingReceivable.id, payload)
                : await createReceivable(payload);

            if (!result.success) {
                setError(result.error || 'Failed to save receivable');
                return;
            }

            setIsFormOpen(false);
            resetForm();
            await fetchData();
            onDataChange?.();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleArchive = async (receivableId: string, archive: boolean) => {
        try {
            const result = await updateReceivable(receivableId, { isArchived: archive });
            if (result.success) {
                setReceivables(prev => prev.map(r => r.id === receivableId ? { ...r, isArchived: archive } : r));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to archive receivable:', err);
        }
    };

    const handleDelete = async (receivableId: string) => {
        if (!confirm('Are you sure you want to delete this receivable? This action cannot be undone.')) {
            return;
        }

        try {
            const result = await deleteReceivable(receivableId);
            if (result.success) {
                setReceivables(prev => prev.filter(r => r.id !== receivableId));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete receivable:', err);
        }
    };

    // Repayment handlers
    const openRepaymentForm = (receivableId: string) => {
        setSelectedReceivableId(receivableId);
        setRepaymentDate(getCurrentYearMonth());
        setRepaymentAmount(0);
        setRepaymentDescription('');
        setIsRepaymentFormOpen(true);
    };

    const handleRepaymentSubmit = async () => {
        if (!selectedReceivableId) return;
        setError('');
        setIsSaving(true);

        try {
            const result = await createRepayment(selectedReceivableId, {
                date: repaymentDate,
                amount: repaymentAmount,
                description: repaymentDescription || undefined,
            });

            if (!result.success) {
                setError(result.error || 'Failed to save repayment');
                return;
            }

            setIsRepaymentFormOpen(false);
            await fetchData();
            onDataChange?.();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteRepayment = async (receivableId: string, repaymentId: string) => {
        if (!confirm('Are you sure you want to delete this repayment?')) return;

        try {
            const result = await deleteRepayment(receivableId, repaymentId);
            if (result.success) {
                await fetchData();
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete repayment:', err);
        }
    };

    return (
        <Dialog
            header="Receivables (Money Owed to You)"
            visible={visible}
            onHide={onHide}
            style={{ width: '90vw', maxWidth: '1200px' }}
            maximizable
            closable
            modal
            dismissableMask
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
                            label="New Receivable"
                            icon="pi pi-plus"
                            onClick={() => openForm()}
                        />
                    </div>

                    {/* Receivables Grid */}
                    {filteredReceivables.length === 0 ? (
                        <div className="text-center py-12">
                            <i className="pi pi-users text-5xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                            <h3 className="text-lg font-semibold mb-2">
                                {showArchived ? 'No archived receivables' : 'No receivables yet'}
                            </h3>
                            <p className="text-gray-500 mb-4">
                                {showArchived
                                    ? 'Archived receivables will appear here'
                                    : 'Track money that others owe you'
                                }
                            </p>
                            {!showArchived && (
                                <Button
                                    label="Add Receivable"
                                    icon="pi pi-plus"
                                    onClick={() => openForm()}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredReceivables.map((receivable) => {
                                const currencyInfo = CURRENCIES.find(c => c.value === receivable.currency);
                                const recRepayments = repayments.get(receivable.id) || [];
                                const isExpanded = expandedReceivableId === receivable.id;
                                const totalRepaid = recRepayments.reduce((sum, r) => sum + r.amount, 0);
                                const percentRepaid = (totalRepaid / receivable.initialPrincipal) * 100;

                                return (
                                    <Card
                                        key={receivable.id}
                                        className="relative group"
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                                                        <i className="pi pi-users text-blue-600 text-sm"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold text-sm">{receivable.name}</h4>
                                                        <p className="text-xs text-gray-500">
                                                            {currencyInfo?.symbol}
                                                            {receivable.hasInterest && ` • ${receivable.annualInterestRate}% interest`}
                                                        </p>
                                                    </div>
                                                </div>
                                                {receivable.isArchived && <Tag value="Archived" severity="warning" className="text-xs" />}
                                            </div>

                                            <div className="space-y-1 text-xs mb-3">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Remaining Balance</span>
                                                    <span className="font-medium text-green-600">
                                                        {formatCurrency(receivable.currentBalance ?? receivable.initialPrincipal, receivable.currency)}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Total Repaid</span>
                                                    <span className="font-medium">
                                                        {formatCurrency(totalRepaid, receivable.currency)} ({percentRepaid.toFixed(0)}%)
                                                    </span>
                                                </div>
                                                {receivable.expectedMonthlyRepayment && receivable.expectedMonthlyRepayment > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500">Expected Monthly</span>
                                                        <span className="font-medium">
                                                            {formatCurrency(receivable.expectedMonthlyRepayment, receivable.currency)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Progress bar */}
                                            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                                                <div
                                                    className="bg-blue-600 h-2 rounded-full"
                                                    style={{ width: `${Math.min(100, percentRepaid)}%` }}
                                                ></div>
                                            </div>

                                            <div className="flex gap-1 pt-2 border-t border-gray-100">
                                                <Button
                                                    icon="pi pi-pencil"
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip="Edit"
                                                    onClick={() => openForm(receivable)}
                                                />
                                                <Button
                                                    icon={receivable.isArchived ? 'pi pi-replay' : 'pi pi-inbox'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={receivable.isArchived ? 'Restore' : 'Archive'}
                                                    onClick={() => handleArchive(receivable.id, !receivable.isArchived)}
                                                />
                                                <Button
                                                    icon="pi pi-trash"
                                                    severity="danger"
                                                    text
                                                    size="small"
                                                    tooltip="Delete"
                                                    onClick={() => handleDelete(receivable.id)}
                                                />
                                                <Button
                                                    icon={isExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={isExpanded ? 'Hide Repayments' : 'Show Repayments'}
                                                    onClick={() => setExpandedReceivableId(isExpanded ? null : receivable.id)}
                                                    className="ml-auto"
                                                />
                                            </div>

                                            {/* Repayments Section */}
                                            {isExpanded && (
                                                <div className="mt-3 pt-3 border-t border-gray-100">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-semibold text-gray-600">Repayments</span>
                                                        <Button
                                                            icon="pi pi-plus"
                                                            size="small"
                                                            text
                                                            onClick={() => openRepaymentForm(receivable.id)}
                                                        />
                                                    </div>
                                                    {recRepayments.length === 0 ? (
                                                        <p className="text-xs text-gray-400">No repayments recorded</p>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {recRepayments.map((repayment) => (
                                                                <div
                                                                    key={repayment.id}
                                                                    className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                                                                >
                                                                    <div>
                                                                        <span className="text-green-600 font-medium">
                                                                            +{formatCurrency(repayment.amount, receivable.currency)}
                                                                        </span>
                                                                        <span className="text-gray-500 ml-2">{repayment.date}</span>
                                                                        {repayment.description && (
                                                                            <span className="text-gray-400 ml-2">{repayment.description}</span>
                                                                        )}
                                                                    </div>
                                                                    <Button
                                                                        icon="pi pi-trash"
                                                                        size="small"
                                                                        text
                                                                        severity="danger"
                                                                        onClick={() => handleDeleteRepayment(receivable.id, repayment.id)}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Add/Edit Receivable Dialog */}
            <Dialog
                header={editingReceivable ? 'Edit Receivable' : 'New Receivable'}
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
                        <label className="font-medium text-sm">Name / Who Owes You</label>
                        <InputText
                            placeholder="e.g., John Doe, Loan to friend"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Description (optional)</label>
                        <InputTextarea
                            placeholder="Notes about this receivable"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
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
                        <label className="font-medium text-sm">Initial Amount</label>
                        <InputNumber
                            value={initialPrincipal}
                            onValueChange={(e) => setInitialPrincipal(e.value || 0)}
                            mode="currency"
                            currency={currency}
                            locale="en-US"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Start Date (YYYY-MM)</label>
                        <InputText
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            placeholder="2026-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Expected Monthly Repayment (optional)</label>
                        <InputNumber
                            value={expectedMonthlyRepayment}
                            onValueChange={(e) => setExpectedMonthlyRepayment(e.value || 0)}
                            mode="currency"
                            currency={currency}
                            locale="en-US"
                        />
                        <small className="text-gray-500">
                            Used for projections. Leave 0 if repayments are irregular.
                        </small>
                    </div>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            inputId="hasInterest"
                            checked={hasInterest}
                            onChange={(e) => setHasInterest(e.checked ?? false)}
                        />
                        <label htmlFor="hasInterest" className="text-sm">Accrues Interest</label>
                    </div>

                    {hasInterest && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Annual Interest Rate (%)</label>
                            <InputNumber
                                value={annualInterestRate}
                                onValueChange={(e) => setAnnualInterestRate(e.value || 0)}
                                suffix="%"
                                minFractionDigits={1}
                                maxFractionDigits={2}
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
                            label={editingReceivable ? 'Save Changes' : 'Add Receivable'}
                            loading={isSaving}
                            onClick={handleSubmit}
                        />
                    </div>
                </div>
            </Dialog>

            {/* Add Repayment Dialog */}
            <Dialog
                header="Record Repayment"
                visible={isRepaymentFormOpen}
                onHide={() => setIsRepaymentFormOpen(false)}
                style={{ width: '400px' }}
                modal
            >
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Date (YYYY-MM)</label>
                        <InputText
                            value={repaymentDate}
                            onChange={(e) => setRepaymentDate(e.target.value)}
                            placeholder="2026-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Amount</label>
                        <InputNumber
                            value={repaymentAmount}
                            onValueChange={(e) => setRepaymentAmount(e.value || 0)}
                            mode="currency"
                            currency={receivables.find(r => r.id === selectedReceivableId)?.currency || 'EUR'}
                            locale="en-US"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Description (optional)</label>
                        <InputText
                            value={repaymentDescription}
                            onChange={(e) => setRepaymentDescription(e.target.value)}
                            placeholder="e.g., Partial payment"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => setIsRepaymentFormOpen(false)}
                        />
                        <Button
                            label="Record Repayment"
                            loading={isSaving}
                            onClick={handleRepaymentSubmit}
                        />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
