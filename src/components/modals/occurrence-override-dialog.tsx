'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { Toast } from 'primereact/toast';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { useTheme } from '@/components/providers/theme-provider';
import { formatYearMonth } from '@/lib/constants';
import {
    upsertRecurringItemOccurrenceOverride,
    deleteRecurringItemOccurrenceOverride,
    getPlannedItems,
} from '@/lib/actions/planned';
import { getRecurringItemById } from '@/lib/actions/recurring';
import type { RecurringItem, YearMonth } from '@/types';
import { MdSave, MdDelete, MdClose, MdSkipNext } from 'react-icons/md';

interface OccurrenceOverrideDialogProps {
    visible: boolean;
    onHide: () => void;
    recurringItemId: string;
    accountId: string;
    yearMonth: YearMonth;
    onDataChange?: () => void;
}

interface OverrideFormData {
    name: string;
    amount: number;
    category: string;
    skipOccurrence: boolean;
}

export function OccurrenceOverrideDialog({
    visible,
    onHide,
    recurringItemId,
    accountId,
    yearMonth,
    onDataChange,
}: OccurrenceOverrideDialogProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const toastRef = useRef<Toast>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [hasExistingOverride, setHasExistingOverride] = useState(false);
    const [recurringItem, setRecurringItem] = useState<RecurringItem | null>(null);
    const [formData, setFormData] = useState<OverrideFormData>({
        name: '',
        amount: 0,
        category: '',
        skipOccurrence: false,
    });

    // Load recurring item details + existing override when dialog opens
    useEffect(() => {
        if (visible && recurringItemId && accountId) {
            setIsLoading(true);
            setHasExistingOverride(false);
            Promise.all([
                getRecurringItemById(accountId, recurringItemId),
                getPlannedItems(accountId),
            ]).then(([itemResult, plannedResult]) => {
                if (itemResult.success && itemResult.data) {
                    const item = itemResult.data;
                    setRecurringItem(item);

                    // Check for existing override
                    const existingOverride = plannedResult.success && plannedResult.data
                        ? plannedResult.data.find(
                            p => p.isRecurringOverride &&
                                p.linkedRecurringItemId === recurringItemId &&
                                p.scheduledDate === yearMonth
                        )
                        : undefined;

                    if (existingOverride) {
                        setHasExistingOverride(true);
                        setFormData({
                            name: existingOverride.name,
                            amount: existingOverride.amount,
                            category: existingOverride.category || '',
                            skipOccurrence: existingOverride.skipOccurrence ?? false,
                        });
                    } else {
                        setFormData({
                            name: item.name,
                            amount: item.amount,
                            category: item.category || '',
                            skipOccurrence: false,
                        });
                    }
                }
            }).finally(() => setIsLoading(false));
        }
    }, [visible, recurringItemId, accountId, yearMonth]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const result = await upsertRecurringItemOccurrenceOverride(
                accountId,
                recurringItemId,
                yearMonth,
                {
                    name: formData.name || undefined,
                    amount: formData.amount || undefined,
                    category: formData.category || null,
                    skipOccurrence: formData.skipOccurrence,
                }
            );
            if (result.success) {
                toastRef.current?.show({
                    severity: 'success',
                    summary: 'Override Saved',
                    detail: formData.skipOccurrence
                        ? `Occurrence skipped for ${formatYearMonth(yearMonth)}`
                        : `Override saved for ${formatYearMonth(yearMonth)}`,
                    life: 3000,
                });
                onDataChange?.();
                onHide();
            } else {
                toastRef.current?.show({
                    severity: 'error',
                    summary: 'Error',
                    detail: result.error || 'Failed to save override',
                    life: 4000,
                });
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteOverride = () => {
        confirmDialog({
            message: `Remove the override for ${formatYearMonth(yearMonth)}? The original recurring item values will be used.`,
            header: 'Restore Original',
            icon: 'pi pi-undo',
            acceptClassName: 'p-button-danger',
            accept: async () => {
                setIsSaving(true);
                try {
                    const result = await deleteRecurringItemOccurrenceOverride(
                        accountId,
                        recurringItemId,
                        yearMonth
                    );
                    if (result.success) {
                        toastRef.current?.show({
                            severity: 'success',
                            summary: 'Override Removed',
                            detail: 'Original recurring item values restored',
                            life: 3000,
                        });
                        onDataChange?.();
                        onHide();
                    } else {
                        toastRef.current?.show({
                            severity: 'error',
                            summary: 'Error',
                            detail: result.error || 'Failed to remove override',
                            life: 4000,
                        });
                    }
                } finally {
                    setIsSaving(false);
                }
            },
        });
    };

    const footer = (
        <div className="flex justify-between items-center">
            <div>
                {hasExistingOverride && (
                    <Button
                        label="Restore Original"
                        icon={<MdDelete />}
                        severity="danger"
                        text
                        onClick={handleDeleteOverride}
                        disabled={isSaving}
                    />
                )}
            </div>
            <div className="flex gap-2">
                <Button
                    label="Cancel"
                    icon={<MdClose />}
                    severity="secondary"
                    text
                    onClick={onHide}
                    disabled={isSaving}
                />
                <Button
                    label="Save Override"
                    icon={<MdSave />}
                    onClick={handleSave}
                    loading={isSaving}
                    disabled={isLoading}
                />
            </div>
        </div>
    );

    return (
        <>
            <Toast ref={toastRef} />
            <ConfirmDialog />
            <Dialog
                header={`Edit Occurrence — ${formatYearMonth(yearMonth)}`}
                visible={visible}
                onHide={onHide}
                footer={footer}
                style={{ width: '28rem' }}
                modal
                closable
                draggable={false}
            >
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <i className="pi pi-spin pi-spinner text-2xl" />
                    </div>
                ) : recurringItem ? (
                    <div className="space-y-4">
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Modify values for this specific month only. The recurring series remains unchanged.
                        </p>

                        {/* Skip occurrence toggle */}
                        <div className={`flex items-center justify-between p-3 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                            <div className="flex items-center gap-2">
                                <MdSkipNext size={20} className={isDark ? 'text-gray-400' : 'text-gray-500'} />
                                <div>
                                    <div className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                                        Skip this occurrence
                                    </div>
                                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Exclude from projection for this month
                                    </div>
                                </div>
                            </div>
                            <InputSwitch
                                checked={formData.skipOccurrence}
                                onChange={(e) => setFormData(prev => ({ ...prev, skipOccurrence: e.value ?? false }))}
                            />
                        </div>

                        {/* Fields (dimmed when skipping) */}
                        <div className={`space-y-3 transition-opacity ${formData.skipOccurrence ? 'opacity-40 pointer-events-none' : ''}`}>
                            <div>
                                <label htmlFor="override-name" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Name
                                </label>
                                <InputText
                                    id="override-name"
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full"
                                    placeholder={recurringItem.name}
                                />
                            </div>

                            <div>
                                <label htmlFor="override-amount" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Amount
                                </label>
                                <InputNumber
                                    id="override-amount"
                                    value={formData.amount}
                                    onValueChange={(e) => setFormData(prev => ({ ...prev, amount: e.value ?? 0 }))}
                                    mode="decimal"
                                    locale="fi-FI"
                                    minFractionDigits={2}
                                    maxFractionDigits={2}
                                    className="w-full"
                                    placeholder={String(recurringItem.amount)}
                                />
                            </div>

                            <div>
                                <label htmlFor="override-category" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Category
                                </label>
                                <InputText
                                    id="override-category"
                                    value={formData.category}
                                    onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                                    className="w-full"
                                    placeholder={recurringItem.category || 'No category'}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-center py-4 text-red-500">Recurring item not found</p>
                )}
            </Dialog>
        </>
    );
}
