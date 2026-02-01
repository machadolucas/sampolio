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
import { formatCurrency, CURRENCIES, FREQUENCIES } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import {
    getInvestmentAccounts,
    createInvestmentAccount,
    updateInvestmentAccount,
    deleteInvestmentAccount,
    getContributions,
    createContribution,
    updateContribution,
    deleteContribution,
} from '@/lib/actions/investments';
import type { InvestmentAccount, InvestmentContribution, Currency, Frequency } from '@/types';

const CONTRIBUTION_TYPES = [
    { label: 'Contribution', value: 'contribution' },
    { label: 'Withdrawal', value: 'withdrawal' },
];

const CONTRIBUTION_KINDS = [
    { label: 'One-off', value: 'one-off' },
    { label: 'Recurring', value: 'recurring' },
];

interface InvestmentsModalContentProps {
    visible: boolean;
    onHide: () => void;
    onDataChange?: () => void;
}

export function InvestmentsModalContent({
    visible,
    onHide,
    onDataChange,
}: InvestmentsModalContentProps) {
    const [investments, setInvestments] = useState<InvestmentAccount[]>([]);
    const [contributions, setContributions] = useState<Map<string, InvestmentContribution[]>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingInvestment, setEditingInvestment] = useState<InvestmentAccount | null>(null);
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Form state for investment account
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [currency, setCurrency] = useState<Currency>('EUR');
    const [startingValuation, setStartingValuation] = useState<number>(0);
    const [valuationDate, setValuationDate] = useState(getCurrentYearMonth());
    const [annualGrowthRate, setAnnualGrowthRate] = useState<number>(7);

    // Contribution form state
    const [isContributionFormOpen, setIsContributionFormOpen] = useState(false);
    const [editingContribution, setEditingContribution] = useState<InvestmentContribution | null>(null);
    const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(null);
    const [contribType, setContribType] = useState<'contribution' | 'withdrawal'>('contribution');
    const [contribKind, setContribKind] = useState<'one-off' | 'recurring'>('one-off');
    const [contribAmount, setContribAmount] = useState<number>(0);
    const [contribScheduledDate, setContribScheduledDate] = useState(getCurrentYearMonth());
    const [contribStartDate, setContribStartDate] = useState(getCurrentYearMonth());
    const [contribEndDate, setContribEndDate] = useState('');
    const [contribFrequency, setContribFrequency] = useState<Frequency>('monthly');
    const [contribDescription, setContribDescription] = useState('');
    const [contribIsActive, setContribIsActive] = useState(true);

    // Expanded card for viewing contributions
    const [expandedInvestmentId, setExpandedInvestmentId] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const result = await getInvestmentAccounts();
            if (result.success && result.data) {
                setInvestments(result.data);
                // Fetch contributions for each investment
                const contribMap = new Map<string, InvestmentContribution[]>();
                for (const inv of result.data) {
                    const contribResult = await getContributions(inv.id);
                    if (contribResult.success && contribResult.data) {
                        contribMap.set(inv.id, contribResult.data);
                    }
                }
                setContributions(contribMap);
            }
        } catch (err) {
            console.error('Failed to fetch investments:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) {
            fetchData();
        }
    }, [visible, fetchData]);

    const filteredInvestments = investments.filter(i => showArchived ? i.isArchived : !i.isArchived);

    const resetForm = () => {
        setName('');
        setDescription('');
        setCurrency('EUR');
        setStartingValuation(0);
        setValuationDate(getCurrentYearMonth());
        setAnnualGrowthRate(7);
        setError('');
        setEditingInvestment(null);
    };

    const openForm = (investment?: InvestmentAccount) => {
        if (investment) {
            setEditingInvestment(investment);
            setName(investment.name);
            setDescription(investment.description || '');
            setCurrency(investment.currency);
            setStartingValuation(investment.startingValuation);
            setValuationDate(investment.valuationDate);
            setAnnualGrowthRate(investment.annualGrowthRate);
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
                startingValuation,
                valuationDate,
                annualGrowthRate,
            };

            const result = editingInvestment
                ? await updateInvestmentAccount(editingInvestment.id, payload)
                : await createInvestmentAccount(payload);

            if (!result.success) {
                setError(result.error || 'Failed to save investment');
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

    const handleArchive = async (investmentId: string, archive: boolean) => {
        try {
            const result = await updateInvestmentAccount(investmentId, { isArchived: archive });
            if (result.success) {
                setInvestments(prev => prev.map(i => i.id === investmentId ? { ...i, isArchived: archive } : i));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to archive investment:', err);
        }
    };

    const handleDelete = async (investmentId: string) => {
        if (!confirm('Are you sure you want to delete this investment account? This action cannot be undone.')) {
            return;
        }

        try {
            const result = await deleteInvestmentAccount(investmentId);
            if (result.success) {
                setInvestments(prev => prev.filter(i => i.id !== investmentId));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete investment:', err);
        }
    };

    // Contribution handlers
    const resetContributionForm = () => {
        setContribType('contribution');
        setContribKind('one-off');
        setContribAmount(0);
        setContribScheduledDate(getCurrentYearMonth());
        setContribStartDate(getCurrentYearMonth());
        setContribEndDate('');
        setContribFrequency('monthly');
        setContribDescription('');
        setContribIsActive(true);
        setEditingContribution(null);
    };

    const openContributionForm = (investmentId: string, contribution?: InvestmentContribution) => {
        setSelectedInvestmentId(investmentId);
        if (contribution) {
            setEditingContribution(contribution);
            setContribType(contribution.type);
            setContribKind(contribution.kind);
            setContribAmount(contribution.amount);
            setContribScheduledDate(contribution.scheduledDate || getCurrentYearMonth());
            setContribStartDate(contribution.startDate || getCurrentYearMonth());
            setContribEndDate(contribution.endDate || '');
            setContribFrequency(contribution.frequency || 'monthly');
            setContribDescription(contribution.description || '');
            setContribIsActive(contribution.isActive);
        } else {
            resetContributionForm();
        }
        setIsContributionFormOpen(true);
    };

    const handleContributionSubmit = async () => {
        if (!selectedInvestmentId) return;
        setError('');
        setIsSaving(true);

        try {
            const payload = {
                type: contribType,
                kind: contribKind,
                amount: contribAmount,
                scheduledDate: contribKind === 'one-off' ? contribScheduledDate : undefined,
                startDate: contribKind === 'recurring' ? contribStartDate : undefined,
                endDate: contribKind === 'recurring' && contribEndDate ? contribEndDate : undefined,
                frequency: contribKind === 'recurring' ? contribFrequency : undefined,
                description: contribDescription || undefined,
                isActive: contribIsActive,
            };

            const result = editingContribution
                ? await updateContribution(selectedInvestmentId, editingContribution.id, payload)
                : await createContribution(selectedInvestmentId, payload);

            if (!result.success) {
                setError(result.error || 'Failed to save contribution');
                return;
            }

            setIsContributionFormOpen(false);
            resetContributionForm();
            await fetchData();
            onDataChange?.();
        } catch {
            setError('An error occurred. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteContribution = async (investmentId: string, contributionId: string) => {
        if (!confirm('Are you sure you want to delete this contribution?')) return;

        try {
            const result = await deleteContribution(investmentId, contributionId);
            if (result.success) {
                await fetchData();
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete contribution:', err);
        }
    };

    return (
        <Dialog
            header="Investment Accounts"
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
                            label="New Investment"
                            icon="pi pi-plus"
                            onClick={() => openForm()}
                        />
                    </div>

                    {/* Investments Grid */}
                    {filteredInvestments.length === 0 ? (
                        <div className="text-center py-12">
                            <i className="pi pi-chart-line text-5xl text-gray-400 mb-4" style={{ display: 'block' }}></i>
                            <h3 className="text-lg font-semibold mb-2">
                                {showArchived ? 'No archived investments' : 'No investment accounts yet'}
                            </h3>
                            <p className="text-gray-500 mb-4">
                                {showArchived
                                    ? 'Archived investments will appear here'
                                    : 'Create your first investment account to track growth'
                                }
                            </p>
                            {!showArchived && (
                                <Button
                                    label="Create Investment"
                                    icon="pi pi-plus"
                                    onClick={() => openForm()}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredInvestments.map((investment) => {
                                const currencyInfo = CURRENCIES.find(c => c.value === investment.currency);
                                const invContributions = contributions.get(investment.id) || [];
                                const isExpanded = expandedInvestmentId === investment.id;

                                return (
                                    <Card
                                        key={investment.id}
                                        className="relative group"
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                                                        <i className="pi pi-chart-line text-green-600 text-sm"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold text-sm">{investment.name}</h4>
                                                        <p className="text-xs text-gray-500">
                                                            {currencyInfo?.symbol} • {investment.annualGrowthRate}% annual
                                                        </p>
                                                    </div>
                                                </div>
                                                {investment.isArchived && <Tag value="Archived" severity="warning" className="text-xs" />}
                                            </div>

                                            <div className="space-y-1 text-xs mb-3">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">Current Valuation</span>
                                                    <span className="font-medium">
                                                        {formatCurrency(investment.currentValuation ?? investment.startingValuation, investment.currency)}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">As of</span>
                                                    <span className="font-medium">{investment.valuationDate}</span>
                                                </div>
                                            </div>

                                            <div className="flex gap-1 pt-2 border-t border-gray-100">
                                                <Button
                                                    icon="pi pi-pencil"
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip="Edit"
                                                    onClick={() => openForm(investment)}
                                                />
                                                <Button
                                                    icon={investment.isArchived ? 'pi pi-replay' : 'pi pi-inbox'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={investment.isArchived ? 'Restore' : 'Archive'}
                                                    onClick={() => handleArchive(investment.id, !investment.isArchived)}
                                                />
                                                <Button
                                                    icon="pi pi-trash"
                                                    severity="danger"
                                                    text
                                                    size="small"
                                                    tooltip="Delete"
                                                    onClick={() => handleDelete(investment.id)}
                                                />
                                                <Button
                                                    icon={isExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'}
                                                    severity="secondary"
                                                    text
                                                    size="small"
                                                    tooltip={isExpanded ? 'Hide Contributions' : 'Show Contributions'}
                                                    onClick={() => setExpandedInvestmentId(isExpanded ? null : investment.id)}
                                                    className="ml-auto"
                                                />
                                            </div>

                                            {/* Contributions Section */}
                                            {isExpanded && (
                                                <div className="mt-3 pt-3 border-t border-gray-100">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-semibold text-gray-600">Contributions/Withdrawals</span>
                                                        <Button
                                                            icon="pi pi-plus"
                                                            size="small"
                                                            text
                                                            onClick={() => openContributionForm(investment.id)}
                                                        />
                                                    </div>
                                                    {invContributions.length === 0 ? (
                                                        <p className="text-xs text-gray-400">No contributions yet</p>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {invContributions.map((contrib) => (
                                                                <div
                                                                    key={contrib.id}
                                                                    className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                                                                >
                                                                    <div>
                                                                        <span className={contrib.type === 'contribution' ? 'text-green-600' : 'text-red-600'}>
                                                                            {contrib.type === 'contribution' ? '+' : '-'}
                                                                            {formatCurrency(contrib.amount, investment.currency)}
                                                                        </span>
                                                                        <span className="text-gray-500 ml-2">
                                                                            {contrib.kind === 'one-off'
                                                                                ? contrib.scheduledDate
                                                                                : `${contrib.frequency} from ${contrib.startDate}`
                                                                            }
                                                                        </span>
                                                                        {!contrib.isActive && <Tag value="Inactive" severity="secondary" className="ml-2 text-xs" />}
                                                                    </div>
                                                                    <div className="flex gap-1">
                                                                        <Button
                                                                            icon="pi pi-pencil"
                                                                            size="small"
                                                                            text
                                                                            severity="secondary"
                                                                            onClick={() => openContributionForm(investment.id, contrib)}
                                                                        />
                                                                        <Button
                                                                            icon="pi pi-trash"
                                                                            size="small"
                                                                            text
                                                                            severity="danger"
                                                                            onClick={() => handleDeleteContribution(investment.id, contrib.id)}
                                                                        />
                                                                    </div>
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

            {/* Add/Edit Investment Dialog */}
            <Dialog
                header={editingInvestment ? 'Edit Investment' : 'New Investment'}
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
                        <label className="font-medium text-sm">Name</label>
                        <InputText
                            placeholder="e.g., Stock Portfolio, 401k"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Description (optional)</label>
                        <InputTextarea
                            placeholder="Notes about this investment"
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
                        <label className="font-medium text-sm">Current Valuation</label>
                        <InputNumber
                            value={startingValuation}
                            onValueChange={(e) => setStartingValuation(e.value || 0)}
                            mode="currency"
                            currency={currency}
                            locale="en-US"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Valuation Date (YYYY-MM)</label>
                        <InputText
                            value={valuationDate}
                            onChange={(e) => setValuationDate(e.target.value)}
                            placeholder="2026-01"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Expected Annual Growth Rate (%)</label>
                        <InputNumber
                            value={annualGrowthRate}
                            onValueChange={(e) => setAnnualGrowthRate(e.value || 0)}
                            suffix="%"
                            minFractionDigits={1}
                            maxFractionDigits={2}
                        />
                    </div>

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
                            label={editingInvestment ? 'Save Changes' : 'Create Investment'}
                            loading={isSaving}
                            onClick={handleSubmit}
                        />
                    </div>
                </div>
            </Dialog>

            {/* Add/Edit Contribution Dialog */}
            <Dialog
                header={editingContribution ? 'Edit Contribution' : 'New Contribution/Withdrawal'}
                visible={isContributionFormOpen}
                onHide={() => {
                    setIsContributionFormOpen(false);
                    resetContributionForm();
                }}
                style={{ width: '500px' }}
                modal
            >
                <div className="space-y-4">
                    {error && <Message severity="error" text={error} className="w-full" />}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Type</label>
                        <Dropdown
                            value={contribType}
                            onChange={(e: DropdownChangeEvent) => setContribType(e.value)}
                            options={CONTRIBUTION_TYPES}
                            optionLabel="label"
                            optionValue="value"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Kind</label>
                        <Dropdown
                            value={contribKind}
                            onChange={(e: DropdownChangeEvent) => setContribKind(e.value)}
                            options={CONTRIBUTION_KINDS}
                            optionLabel="label"
                            optionValue="value"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Amount</label>
                        <InputNumber
                            value={contribAmount}
                            onValueChange={(e) => setContribAmount(e.value || 0)}
                            mode="currency"
                            currency={investments.find(i => i.id === selectedInvestmentId)?.currency || 'EUR'}
                            locale="en-US"
                        />
                    </div>

                    {contribKind === 'one-off' && (
                        <div className="flex flex-col gap-2">
                            <label className="font-medium text-sm">Scheduled Date (YYYY-MM)</label>
                            <InputText
                                value={contribScheduledDate}
                                onChange={(e) => setContribScheduledDate(e.target.value)}
                                placeholder="2026-01"
                            />
                        </div>
                    )}

                    {contribKind === 'recurring' && (
                        <>
                            <div className="flex flex-col gap-2">
                                <label className="font-medium text-sm">Frequency</label>
                                <Dropdown
                                    value={contribFrequency}
                                    onChange={(e: DropdownChangeEvent) => setContribFrequency(e.value)}
                                    options={FREQUENCIES}
                                    optionLabel="label"
                                    optionValue="value"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="font-medium text-sm">Start Date (YYYY-MM)</label>
                                <InputText
                                    value={contribStartDate}
                                    onChange={(e) => setContribStartDate(e.target.value)}
                                    placeholder="2026-01"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="font-medium text-sm">End Date (YYYY-MM, optional)</label>
                                <InputText
                                    value={contribEndDate}
                                    onChange={(e) => setContribEndDate(e.target.value)}
                                    placeholder="2030-12"
                                />
                            </div>
                        </>
                    )}

                    <div className="flex flex-col gap-2">
                        <label className="font-medium text-sm">Description (optional)</label>
                        <InputText
                            value={contribDescription}
                            onChange={(e) => setContribDescription(e.target.value)}
                            placeholder="Notes about this contribution"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            inputId="contribActive"
                            checked={contribIsActive}
                            onChange={(e) => setContribIsActive(e.checked ?? true)}
                        />
                        <label htmlFor="contribActive" className="text-sm">Active</label>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button
                            label="Cancel"
                            severity="secondary"
                            outlined
                            onClick={() => {
                                setIsContributionFormOpen(false);
                                resetContributionForm();
                            }}
                        />
                        <Button
                            label={editingContribution ? 'Save Changes' : 'Add Contribution'}
                            loading={isSaving}
                            onClick={handleContributionSubmit}
                        />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
