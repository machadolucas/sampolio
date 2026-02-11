'use client';

import { useState, useEffect, useCallback } from 'react';
import { MdWarning, MdArrowBack, MdArrowForward, MdCheck, MdError } from 'react-icons/md';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Steps } from 'primereact/steps';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { useTheme } from '@/components/providers/theme-provider';
import { formatCurrency, formatYearMonth, MONTHS } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import { getAccounts } from '@/lib/actions/accounts';
import { getInvestmentAccounts } from '@/lib/actions/investments';
import { getReceivables } from '@/lib/actions/receivables';
import { getDebts } from '@/lib/actions/debts';
import {
    startReconciliationSession,
    createBalanceSnapshot,
    completeReconciliationSession,
    applyReconciliationBalances,
} from '@/lib/actions/reconciliation';
import type { FinancialAccount, InvestmentAccount, Receivable, Debt, EntityType, Currency } from '@/types';

interface ReconcileWizardProps {
    visible: boolean;
    onHide: () => void;
    onComplete?: () => void;
    initialYearMonth?: string;
}

interface EntityRow {
    entityType: EntityType;
    entityId: string;
    name: string;
    currency: Currency;
    expectedBalance: number;
    actualBalance: number | null;
    variance: number;
}

const WIZARD_STEPS = [
    { label: 'Select Month' },
    { label: 'Enter Balances' },
    { label: 'Review & Confirm' },
];

export function ReconcileWizard({
    visible,
    onHide,
    onComplete,
    initialYearMonth,
}: ReconcileWizardProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [activeStep, setActiveStep] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    // Step 1: Month selection
    const [selectedYearMonth, setSelectedYearMonth] = useState(initialYearMonth || getCurrentYearMonth());
    const [selectedYear, setSelectedYear] = useState(parseInt(selectedYearMonth.split('-')[0]));
    const [selectedMonth, setSelectedMonth] = useState(parseInt(selectedYearMonth.split('-')[1]));

    // Entity data
    const [entities, setEntities] = useState<EntityRow[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);

    // Fetch all entities
    const fetchEntities = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            const [accountsResult, investmentsResult, receivablesResult, debtsResult] = await Promise.all([
                getAccounts(),
                getInvestmentAccounts(),
                getReceivables(),
                getDebts(),
            ]);

            const rows: EntityRow[] = [];

            // Cash accounts
            if (accountsResult.success && accountsResult.data) {
                for (const account of accountsResult.data.filter((a: FinancialAccount) => !a.isArchived)) {
                    rows.push({
                        entityType: 'cash-account',
                        entityId: account.id,
                        name: account.name,
                        currency: account.currency,
                        expectedBalance: account.startingBalance, // TODO: Calculate projected balance
                        actualBalance: null,
                        variance: 0,
                    });
                }
            }

            // Investments
            if (investmentsResult.success && investmentsResult.data) {
                for (const investment of investmentsResult.data.filter((i: InvestmentAccount) => !i.isArchived)) {
                    rows.push({
                        entityType: 'investment',
                        entityId: investment.id,
                        name: investment.name,
                        currency: investment.currency,
                        expectedBalance: investment.currentValuation || investment.startingValuation,
                        actualBalance: null,
                        variance: 0,
                    });
                }
            }

            // Receivables
            if (receivablesResult.success && receivablesResult.data) {
                for (const receivable of receivablesResult.data.filter((r: Receivable) => !r.isArchived)) {
                    rows.push({
                        entityType: 'receivable',
                        entityId: receivable.id,
                        name: receivable.name,
                        currency: receivable.currency,
                        expectedBalance: receivable.currentBalance,
                        actualBalance: null,
                        variance: 0,
                    });
                }
            }

            // Debts
            if (debtsResult.success && debtsResult.data) {
                for (const debt of debtsResult.data.filter((d: Debt) => !d.isArchived)) {
                    rows.push({
                        entityType: 'debt',
                        entityId: debt.id,
                        name: debt.name,
                        currency: debt.currency,
                        expectedBalance: -debt.currentPrincipal, // Negative for debts
                        actualBalance: null,
                        variance: 0,
                    });
                }
            }

            setEntities(rows);
        } catch (err) {
            setError('Failed to load entities');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) {
            fetchEntities();
            setActiveStep(0);
            setSessionId(null);
        }
    }, [visible, fetchEntities]);

    // Update yearMonth when year/month changes
    useEffect(() => {
        setSelectedYearMonth(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`);
    }, [selectedYear, selectedMonth]);

    const handleActualBalanceChange = (entityId: string, value: number | null) => {
        setEntities(prev => prev.map(e => {
            if (e.entityId === entityId) {
                const actual = value ?? 0;
                return {
                    ...e,
                    actualBalance: value,
                    variance: actual - e.expectedBalance,
                };
            }
            return e;
        }));
    };

    const handleStartSession = async () => {
        const result = await startReconciliationSession(selectedYearMonth);
        if (result.success && result.data) {
            setSessionId(result.data.id);
            setActiveStep(1);
        } else {
            setError(result.error || 'Failed to start session');
        }
    };

    const handleComplete = async () => {
        if (!sessionId) return;

        setIsSaving(true);
        setError('');

        try {
            // Create snapshots for all entities with actual balances
            for (const entity of entities) {
                if (entity.actualBalance !== null) {
                    await createBalanceSnapshot({
                        entityType: entity.entityType,
                        entityId: entity.entityId,
                        yearMonth: selectedYearMonth,
                        expectedBalance: entity.expectedBalance,
                        actualBalance: entity.actualBalance,
                    });
                }
            }

            // Apply actual balances to the entities so projections use
            // the reconciled values going forward
            const entriesToApply = entities
                .filter(e => e.actualBalance !== null)
                .map(e => ({
                    entityType: e.entityType,
                    entityId: e.entityId,
                    actualBalance: e.actualBalance!,
                }));

            if (entriesToApply.length > 0) {
                const applyResult = await applyReconciliationBalances(entriesToApply);
                if (!applyResult.success) {
                    setError(applyResult.error || 'Failed to apply balances');
                    setIsSaving(false);
                    return;
                }
            }

            // Complete the session
            await completeReconciliationSession(sessionId);

            onComplete?.();
            onHide();
        } catch (err) {
            setError('Failed to complete reconciliation');
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    const entitiesWithVariance = entities.filter(e => e.actualBalance !== null && e.variance !== 0);
    const entitiesEntered = entities.filter(e => e.actualBalance !== null);
    const totalVariance = entitiesWithVariance.reduce((sum, e) => sum + e.variance, 0);

    const yearOptions = Array.from({ length: 5 }, (_, i) => {
        const year = new Date().getFullYear() - 2 + i;
        return { label: String(year), value: year };
    });

    const monthOptions = MONTHS.map((name, i) => ({
        label: name,
        value: i + 1,
    }));

    const renderEntityTypeLabel = (type: EntityType) => {
        const labels: Record<EntityType, { label: string; severity: 'info' | 'success' | 'warning' | 'danger' }> = {
            'cash-account': { label: 'Cash', severity: 'info' },
            'investment': { label: 'Investment', severity: 'success' },
            'receivable': { label: 'Receivable', severity: 'warning' },
            'debt': { label: 'Debt', severity: 'danger' },
        };
        const config = labels[type];
        return <Tag value={config.label} severity={config.severity} />;
    };

    const renderStep = () => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center py-12">
                    <ProgressSpinner style={{ width: '50px', height: '50px' }} />
                </div>
            );
        }

        switch (activeStep) {
            case 0: // Select Month
                return (
                    <div className="space-y-6">
                        <p className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                            Select the month you want to reconcile. This will compare your expected balances
                            with actual values and help track any differences.
                        </p>

                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Year
                                </label>
                                <Dropdown
                                    value={selectedYear}
                                    options={yearOptions}
                                    onChange={(e) => setSelectedYear(e.value)}
                                    className="w-full"
                                />
                            </div>
                            <div className="flex-1">
                                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Month
                                </label>
                                <Dropdown
                                    value={selectedMonth}
                                    options={monthOptions}
                                    onChange={(e) => setSelectedMonth(e.value)}
                                    className="w-full"
                                />
                            </div>
                        </div>

                        <Card className="mt-6">
                            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                <p className="font-medium mb-2">Entities to reconcile:</p>
                                <ul className="list-disc list-inside space-y-1">
                                    <li>{entities.filter(e => e.entityType === 'cash-account').length} Cash Accounts</li>
                                    <li>{entities.filter(e => e.entityType === 'investment').length} Investments</li>
                                    <li>{entities.filter(e => e.entityType === 'receivable').length} Receivables</li>
                                    <li>{entities.filter(e => e.entityType === 'debt').length} Debts</li>
                                </ul>
                            </div>
                        </Card>
                    </div>
                );

            case 1: // Enter Balances
                return (
                    <div className="space-y-4">
                        <p className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                            Enter the actual balance for each entity as of {formatYearMonth(selectedYearMonth)}.
                        </p>

                        {['cash-account', 'investment', 'receivable', 'debt'].map((type) => {
                            const typeEntities = entities.filter(e => e.entityType === type);
                            if (typeEntities.length === 0) return null;

                            return (
                                <div key={type} className="mb-6">
                                    <h3 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {type === 'cash-account' ? 'Cash Accounts' :
                                            type === 'investment' ? 'Investments' :
                                                type === 'receivable' ? 'Receivables' : 'Debts'}
                                    </h3>
                                    <div className="space-y-3">
                                        {typeEntities.map((entity) => (
                                            <div
                                                key={entity.entityId}
                                                className={`p-4 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                                            >
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                                        {entity.name}
                                                    </span>
                                                    <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                                        Expected: {formatCurrency(entity.expectedBalance, entity.currency)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex-1">
                                                        <InputNumber
                                                            value={entity.actualBalance}
                                                            onValueChange={(e) => handleActualBalanceChange(entity.entityId, e.value ?? null)}
                                                            mode="currency"
                                                            currency={entity.currency}
                                                            locale="fi-FI"
                                                            placeholder="Enter actual balance"
                                                            className="w-full"
                                                        />
                                                    </div>
                                                    {entity.actualBalance !== null && entity.variance !== 0 && (
                                                        <Tag
                                                            value={`${entity.variance >= 0 ? '+' : ''}${formatCurrency(entity.variance, entity.currency)}`}
                                                            severity={entity.variance >= 0 ? 'success' : 'danger'}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );

            case 2: // Review & Confirm
                return (
                    <div className="space-y-6">
                        <div className={`p-6 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                            <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                Reconciliation Summary for {formatYearMonth(selectedYearMonth)}
                            </h3>

                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div>
                                    <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Entities Updated
                                    </span>
                                    <p className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                        {entitiesEntered.length}
                                    </p>
                                </div>
                                <div>
                                    <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Total Variance
                                    </span>
                                    <p className={`text-2xl font-bold ${totalVariance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance, 'EUR')}
                                    </p>
                                </div>
                            </div>

                            {entitiesEntered.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                        Changes
                                    </h4>
                                    {entitiesEntered.map((entity) => (
                                        <div key={entity.entityId} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
                                            <div className="flex items-center gap-2">
                                                {renderEntityTypeLabel(entity.entityType)}
                                                <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                                                    {entity.name}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <span className={isDark ? 'text-gray-100' : 'text-gray-900'}>
                                                    {formatCurrency(entity.actualBalance || 0, entity.currency)}
                                                </span>
                                                {entity.variance !== 0 && (
                                                    <span className={`ml-2 text-sm ${entity.variance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        ({entity.variance >= 0 ? '+' : ''}{formatCurrency(entity.variance, entity.currency)})
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {entitiesEntered.length === 0 && (
                            <div className={`flex items-center justify-center py-4 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                                <MdWarning className="mr-2" />
                                No balances were entered. Please go back and enter at least one balance.
                            </div>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    const renderFooter = () => {
        const canProceed = () => {
            switch (activeStep) {
                case 0: return entities.length > 0;
                case 1: return true; // Can proceed without entering all balances
                case 2: return entitiesEntered.length > 0;
                default: return false;
            }
        };

        return (
            <div className="flex justify-between pt-4">
                <Button
                    label="Back"
                    icon={<MdArrowBack />}
                    text
                    onClick={() => setActiveStep(s => s - 1)}
                    disabled={activeStep === 0}
                />
                {activeStep < 2 ? (
                    <Button
                        label="Continue"
                        icon={<MdArrowForward />}
                        iconPos="right"
                        onClick={() => {
                            if (activeStep === 0) {
                                handleStartSession();
                            } else {
                                setActiveStep(s => s + 1);
                            }
                        }}
                        disabled={!canProceed()}
                    />
                ) : (
                    <Button
                        label="Complete Reconciliation"
                        icon={<MdCheck />}
                        severity="success"
                        onClick={handleComplete}
                        loading={isSaving}
                        disabled={!canProceed()}
                    />
                )}
            </div>
        );
    };

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header="Monthly Reconciliation"
            style={{ width: '700px', maxWidth: '95vw' }}
            modal
            dismissableMask
            footer={renderFooter()}
        >
            <div className="space-y-6">
                <Steps model={WIZARD_STEPS} activeIndex={activeStep} readOnly />

                {error && (
                    <div className="flex items-center p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500">
                        <MdError className="mr-2" />
                        {error}
                    </div>
                )}

                <div className="min-h-100">
                    {renderStep()}
                </div>
            </div>
        </Dialog>
    );
}
