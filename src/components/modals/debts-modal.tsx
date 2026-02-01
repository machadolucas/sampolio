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
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { formatCurrency, CURRENCIES } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import {
    getDebts,
    createDebt,
    updateDebt,
    deleteDebt,
    getReferenceRates,
    setReferenceRate,
    getExtraPayments,
    createExtraPayment,
} from '@/lib/actions/debts';
import type { Debt, DebtReferenceRate, DebtExtraPayment, Currency } from '@/types';

const DEBT_TYPES = [
    { label: 'Amortized Loan (e.g., Mortgage)', value: 'amortized' },
    { label: 'Fixed Installments (e.g., Buy Now Pay Later)', value: 'fixed-installment' },
];

const INTEREST_MODEL_TYPES = [
    { label: 'No Interest', value: 'none' },
    { label: 'Fixed Rate', value: 'fixed' },
    { label: 'Variable Rate (Reference + Margin)', value: 'variable' },
];

interface DebtsModalContentProps {
    visible: boolean;
    onHide: () => void;
    onDataChange?: () => void;
}

export function DebtsModalContent({
    visible,
    onHide,
    onDataChange,
}: DebtsModalContentProps) {
    const [debts, setDebts] = useState<Debt[]>([]);
    const [referenceRates, setReferenceRates] = useState<Map<string, DebtReferenceRate[]>>(new Map());
    const [extraPayments, setExtraPayments] = useState<Map<string, DebtExtraPayment[]>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Form state for debt
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [currency, setCurrency] = useState<Currency>('EUR');
    const [debtType, setDebtType] = useState<'amortized' | 'fixed-installment'>('amortized');
    const [initialPrincipal, setInitialPrincipal] = useState<number>(0);
    const [startDate, setStartDate] = useState(getCurrentYearMonth());
    const [interestModelType, setInterestModelType] = useState<'none' | 'fixed' | 'variable'>('fixed');
    const [fixedInterestRate, setFixedInterestRate] = useState<number>(0);
    const [referenceRateMargin, setReferenceRateMargin] = useState<number>(0);
    const [monthlyPayment, setMonthlyPayment] = useState<number>(0);
    const [totalInstallments, setTotalInstallments] = useState<number>(0);
    const [installmentAmount, setInstallmentAmount] = useState<number>(0);

    // Reference rate form state
    const [isRateFormOpen, setIsRateFormOpen] = useState(false);
    const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
    const [rateYearMonth, setRateYearMonth] = useState(getCurrentYearMonth());
    const [rateValue, setRateValue] = useState<number>(0);

    // Extra payment form state
    const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
    const [paymentDate, setPaymentDate] = useState(getCurrentYearMonth());
    const [paymentAmount, setPaymentAmount] = useState<number>(0);
    const [paymentDescription, setPaymentDescription] = useState('');

    // Expanded card for viewing details
    const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const result = await getDebts();
            if (result.success && result.data) {
                setDebts(result.data);
                // Fetch rates and extra payments for each debt
                const ratesMap = new Map<string, DebtReferenceRate[]>();
                const paymentsMap = new Map<string, DebtExtraPayment[]>();
                for (const debt of result.data) {
                    const ratesResult = await getReferenceRates(debt.id);
                    if (ratesResult.success && ratesResult.data) {
                        ratesMap.set(debt.id, ratesResult.data);
                    }
                    const paymentsResult = await getExtraPayments(debt.id);
                    if (paymentsResult.success && paymentsResult.data) {
                        paymentsMap.set(debt.id, paymentsResult.data);
                    }
                }
                setReferenceRates(ratesMap);
                setExtraPayments(paymentsMap);
            }
        } catch (err) {
            console.error('Failed to fetch debts:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) {
            fetchData();
        }
    }, [visible, fetchData]);

    const filteredDebts = debts.filter(d => showArchived ? d.isArchived : !d.isArchived);

    const resetForm = () => {
        setName('');
        setDescription('');
        setCurrency('EUR');
        setDebtType('amortized');
        setInitialPrincipal(0);
        setStartDate(getCurrentYearMonth());
        setInterestModelType('fixed');
        setFixedInterestRate(0);
        setReferenceRateMargin(0);
        setMonthlyPayment(0);
        setTotalInstallments(0);
        setInstallmentAmount(0);
        setError('');
        setEditingDebt(null);
    };

    const openForm = (debt?: Debt) => {
        if (debt) {
            setEditingDebt(debt);
            setName(debt.name);
            setDescription(debt.description || '');
            setCurrency(debt.currency);
            setDebtType(debt.debtType);
            setInitialPrincipal(debt.initialPrincipal);
            setStartDate(debt.startDate);
            setInterestModelType(debt.interestModelType);
            setFixedInterestRate(debt.fixedInterestRate || 0);
            setReferenceRateMargin(debt.referenceRateMargin || 0);
            setMonthlyPayment(debt.monthlyPayment || 0);
            setTotalInstallments(debt.totalInstallments || 0);
            setInstallmentAmount(debt.installmentAmount || 0);
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
                debtType,
                initialPrincipal,
                startDate,
                interestModelType,
                fixedInterestRate: interestModelType === 'fixed' ? fixedInterestRate : undefined,
                referenceRateMargin: interestModelType === 'variable' ? referenceRateMargin : undefined,
                monthlyPayment: debtType === 'amortized' ? monthlyPayment : undefined,
                totalInstallments: debtType === 'fixed-installment' ? totalInstallments : undefined,
                installmentAmount: debtType === 'fixed-installment' ? installmentAmount : undefined,
            };

            const result = editingDebt
                ? await updateDebt(editingDebt.id, payload)
                : await createDebt(payload);

            if (!result.success) {
                setError(result.error || 'Failed to save debt');
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

    const handleArchive = async (debtId: string, archive: boolean) => {
        try {
            const result = await updateDebt(debtId, { isArchived: archive });
            if (result.success) {
                setDebts(prev => prev.map(d => d.id === debtId ? { ...d, isArchived: archive } : d));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to archive debt:', err);
        }
    };

    const handleDelete = async (debtId: string) => {
        if (!confirm('Are you sure you want to delete this debt? This action cannot be undone.')) {
            return;
        }

        try {
            const result = await deleteDebt(debtId);
            if (result.success) {
                setDebts(prev => prev.filter(d => d.id !== debtId));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete debt:', err);
        }
    };

    // Reference rate handlers
    const openRateForm = (debtId: string) => {
        setSelectedDebtId(debtId);
        setRateYearMonth(getCurrentYearMonth());
        setRateValue(0);
        setIsRateFormOpen(true);
    };

    const handleRateSubmit = async () => {
        if (!selectedDebtId) return;
        setError('');
        setIsSaving(true);

        try {
            const result = await setReferenceRate(selectedDebtId, rateYearMonth, rateValue);

            if (!result.success) {
                setError(result.error || 'Failed to save rate');
                return;
            }

            setIsRateFormOpen(false);
            await fetchData();
            onDataChange?.();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    // Extra payment handlers
    const openPaymentForm = (debtId: string) => {
        setSelectedDebtId(debtId);
        setPaymentDate(getCurrentYearMonth());
        setPaymentAmount(0);
        setPaymentDescription('');
        setIsPaymentFormOpen(true);
    };

    const handlePaymentSubmit = async () => {
        if (!selectedDebtId) return;
        setError('');
        setIsSaving(true);

        try {
            const result = await createExtraPayment(selectedDebtId, {
                date: paymentDate,
                amount: paymentAmount,
                description: paymentDescription || undefined,
            });

            if (!result.success) {
                setError(result.error || 'Failed to save payment');
                return;
            }

            setIsPaymentFormOpen(false);
            await fetchData();
            onDataChange?.();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const getInterestDisplay = (debt: Debt) => {
        if (debt.interestModelType === 'none') return 'No Interest';
        if (debt.interestModelType === 'fixed') return `${debt.fixedInterestRate}% fixed`;
        return `Reference + ${debt.referenceRateMargin}%`;
    };

    return (
        <Dialog
            header="Debts & Liabilities"
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
                            label="New Debt"
                            icon="pi pi-plus"
                            onClick={() => openForm()}
                        />
                    </div>

                    {/* Debts Grid */}
                    {filteredDebts.length === 0 ? (
                        <div className="text-center py-12">
                            <i className="pi pi-credit-card text-5xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                            <h3 className="text-lg font-semibold mb-2">
                                {showArchived ? 'No archived debts' : 'No debts yet'}
                            </h3>
                            <p className="text-gray-500 mb-4">
                                {showArchived
                                    ? 'Archived debts will appear here'
                                    : 'Add your first debt to track liabilities'
                                }
                            </p>
                            {!showArchived && (
                                <Button
                                    label="Add Debt"
                                    icon="pi pi-plus"
                                    onClick={() => openForm()}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredDebts.map((debt) => {
                                const currencyInfo = CURRENCIES.find(c => c.value === debt.currency);
                                const debtRates = referenceRates.get(debt.id) || [];
                                const debtPayments = extraPayments.get(debt.id) || [];
                                const isExpanded = expandedDebtId === debt.id;

                                return (
                                    <Card
                                        key={debt.id}
                                        className="relative group"
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                                                        <i className="pi pi-credit-card text-red-600 text-sm"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold text-sm">{debt.name}</h4>
                                                        <p className="text-xs text-gray-500">
                                                            {currencyInfo?.symbol} • {debt.debtType === 'amortized' ? 'Amortized' : 'Fixed Installments'}
                                                        </p>
                                                    </div>
                                                </div>
                                                {debt.isArchived && <Tag value="Archived" severity="warning" className="text-xs" />}
                                            </div>

                                            <div className="space-y-1 text-xs mb-3">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Remaining</span>
                                                    <span className="font-medium text-red-600">
                                                        {formatCurrency(debt.currentPrincipal ?? debt.initialPrincipal, debt.currency)}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Interest</span>
                                                    <span className="font-medium">{getInterestDisplay(debt)}</span>
                                                </div>
                                                {debt.debtType === 'amortized' && (
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500">Monthly Payment</span>
                                                        <span className="font-medium">
                                                            {formatCurrency(debt.monthlyPayment ?? 0, debt.currency)}
                                                        </span>
                                                    </div>
                                                )}
                                                {debt.debtType === 'fixed-installment' && (
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500">Installments</span>
                                                        <span className="font-medium">
                                                            {debt.totalInstallments} × {formatCurrency(debt.installmentAmount ?? 0, debt.currency)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex gap-1 pt-2 border-t border-gray-100">
                                                <Button
                                                    icon="pi pi-pencil"
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip="Edit"
                                                    onClick={() => openForm(debt)}
                                                />
                                                <Button
                                                    icon={debt.isArchived ? 'pi pi-replay' : 'pi pi-inbox'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={debt.isArchived ? 'Restore' : 'Archive'}
                                                    onClick={() => handleArchive(debt.id, !debt.isArchived)}
                                                />
                                                <Button
                                                    icon="pi pi-trash"
                                                    severity="danger"
                                                    text
                                                    size="small"
                                                    tooltip="Delete"
                                                    onClick={() => handleDelete(debt.id)}
                                                />
                                                <Button
                                                    icon={isExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={isExpanded ? 'Hide Details' : 'Show Details'}
                                                    onClick={() => setExpandedDebtId(isExpanded ? null : debt.id)}
                                                    className="ml-auto"
                                                />
                                            </div>

                                            {/* Details Section */}
                                            {isExpanded && (
                                                <div className="mt-3 pt-3 border-t border-gray-100 space-y-4">
                                                    {/* Reference Rates for variable rate debts */}
                                                    {debt.interestModelType === 'variable' && (
                                                        <div>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-xs font-semibold text-gray-600">Reference Rates</span>
                                                                <Button
                                                                    icon="pi pi-plus"
                                                                    size="small"
                                                                    text
                                                                    onClick={() => openRateForm(debt.id)}
                                                                />
                                                            </div>
                                                            {debtRates.length === 0 ? (
                                                                <p className="text-xs text-gray-400">No rates set</p>
                                                            ) : (
                                                                <div className="space-y-1">
                                                                    {debtRates.slice(0, 5).map((rate) => (
                                                                        <div
                                                                            key={rate.yearMonth}
                                                                            className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                                                                        >
                                                                            <span>{rate.yearMonth}</span>
                                                                            <span className="font-medium">{rate.rate}%</span>
                                                                        </div>
                                                                    ))}
                                                                    {debtRates.length > 5 && (
                                                                        <p className="text-xs text-gray-400">+{debtRates.length - 5} more</p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Extra Payments */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-xs font-semibold text-gray-600">Extra Payments</span>
                                                            <Button
                                                                icon="pi pi-plus"
                                                                size="small"
                                                                text
                                                                onClick={() => openPaymentForm(debt.id)}
                                                            />
                                                        </div>
                                                        {debtPayments.length === 0 ? (
                                                            <p className="text-xs text-gray-400">No extra payments</p>
                                                        ) : (
                                                            <div className="space-y-1">
                                                                {debtPayments.map((payment) => (
                                                                    <div
                                                                        key={payment.id}
                                                                        className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                                                                    >
                                                                        <div>
                                                                            <span>{payment.date}</span>
                                                                            {payment.description && (
                                                                                <span className="text-gray-500 ml-2">{payment.description}</span>
                                                                            )}
                                                                        </div>
                                                                        <span className="font-medium text-green-600">
                                                                            {formatCurrency(payment.amount, debt.currency)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
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

            {/* Add/Edit Debt Dialog */}
            <Dialog
                header={editingDebt ? 'Edit Debt' : 'New Debt'}
                visible={isFormOpen}
                onHide={() => {
                    setIsFormOpen(false);
                    resetForm();
                }}
                style={{ width: '550px' }}
                modal
            >
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Name</label>
                        <InputText
                            placeholder="e.g., Mortgage, Car Loan"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Description (optional)</label>
                        <InputTextarea
                            placeholder="Notes about this debt"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
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
                            <label className="font-medium text-sm">Debt Type</label>
                            <Dropdown
                                value={debtType}
                                onChange={(e: DropdownChangeEvent) => setDebtType(e.value)}
                                options={DEBT_TYPES}
                                optionLabel="label"
                                optionValue="value"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Initial Principal</label>
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
                            placeholder="2024-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Interest Model</label>
                        <Dropdown
                            value={interestModelType}
                            onChange={(e: DropdownChangeEvent) => setInterestModelType(e.value)}
                            options={INTEREST_MODEL_TYPES}
                            optionLabel="label"
                            optionValue="value"
                        />
                    </div>

                    {interestModelType === 'fixed' && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Fixed Interest Rate (%)</label>
                            <InputNumber
                                value={fixedInterestRate}
                                onValueChange={(e) => setFixedInterestRate(e.value || 0)}
                                suffix="%"
                                minFractionDigits={2}
                                maxFractionDigits={3}
                            />
                        </div>
                    )}

                    {interestModelType === 'variable' && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Margin over Reference Rate (%)</label>
                            <InputNumber
                                value={referenceRateMargin}
                                onValueChange={(e) => setReferenceRateMargin(e.value || 0)}
                                suffix="%"
                                minFractionDigits={2}
                                maxFractionDigits={3}
                            />
                            <small className="text-gray-500">
                                You can set reference rates (e.g., Euribor) in the debt details after creation.
                            </small>
                        </div>
                    )}

                    {debtType === 'amortized' && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Monthly Payment</label>
                            <InputNumber
                                value={monthlyPayment}
                                onValueChange={(e) => setMonthlyPayment(e.value || 0)}
                                mode="currency"
                                currency={currency}
                                locale="en-US"
                            />
                        </div>
                    )}

                    {debtType === 'fixed-installment' && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="font-medium text-sm">Total Installments</label>
                                <InputNumber
                                    value={totalInstallments}
                                    onValueChange={(e) => setTotalInstallments(e.value || 0)}
                                    min={1}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="font-medium text-sm">Installment Amount</label>
                                <InputNumber
                                    value={installmentAmount}
                                    onValueChange={(e) => setInstallmentAmount(e.value || 0)}
                                    mode="currency"
                                    currency={currency}
                                    locale="en-US"
                                />
                            </div>
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
                            label={editingDebt ? 'Save Changes' : 'Add Debt'}
                            loading={isSaving}
                            onClick={handleSubmit}
                        />
                    </div>
                </div>
            </Dialog>

            {/* Reference Rate Dialog */}
            <Dialog
                header="Set Reference Rate"
                visible={isRateFormOpen}
                onHide={() => setIsRateFormOpen(false)}
                style={{ width: '400px' }}
                modal
            >
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Month (YYYY-MM)</label>
                        <InputText
                            value={rateYearMonth}
                            onChange={(e) => setRateYearMonth(e.target.value)}
                            placeholder="2026-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Reference Rate (%)</label>
                        <InputNumber
                            value={rateValue}
                            onValueChange={(e) => setRateValue(e.value || 0)}
                            suffix="%"
                            minFractionDigits={3}
                            maxFractionDigits={4}
                        />
                        <small className="text-gray-500">
                            e.g., Euribor 12M rate. The margin will be added to this.
                        </small>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => setIsRateFormOpen(false)}
                        />
                        <Button
                            label="Save Rate"
                            loading={isSaving}
                            onClick={handleRateSubmit}
                        />
                    </div>
                </div>
            </Dialog>

            {/* Extra Payment Dialog */}
            <Dialog
                header="Add Extra Payment"
                visible={isPaymentFormOpen}
                onHide={() => setIsPaymentFormOpen(false)}
                style={{ width: '400px' }}
                modal
            >
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Date (YYYY-MM)</label>
                        <InputText
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            placeholder="2026-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Amount</label>
                        <InputNumber
                            value={paymentAmount}
                            onValueChange={(e) => setPaymentAmount(e.value || 0)}
                            mode="currency"
                            currency={debts.find(d => d.id === selectedDebtId)?.currency || 'EUR'}
                            locale="en-US"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Description (optional)</label>
                        <InputText
                            value={paymentDescription}
                            onChange={(e) => setPaymentDescription(e.target.value)}
                            placeholder="e.g., Bonus payment"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => setIsPaymentFormOpen(false)}
                        />
                        <Button
                            label="Add Payment"
                            loading={isSaving}
                            onClick={handlePaymentSubmit}
                        />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
