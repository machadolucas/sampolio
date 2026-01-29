'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputSwitch, InputSwitchChangeEvent } from 'primereact/inputswitch';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import {
    getSalaryConfigs,
    createSalaryConfig,
    updateSalaryConfig,
    deleteSalaryConfig,
} from '@/lib/actions/salary';
import type { FinancialAccount, SalaryConfig, Currency } from '@/types';

function calculateNetSalary(
    grossSalary: number,
    taxRate: number,
    contributionsRate: number,
    otherDeductions: number
): number {
    const taxAmount = grossSalary * (taxRate / 100);
    const contributionsAmount = grossSalary * (contributionsRate / 100);
    return grossSalary - taxAmount - contributionsAmount - otherDeductions;
}

interface SalaryModalProps {
    visible: boolean;
    onHide: () => void;
    selectedAccountId: string;
    accounts: FinancialAccount[];
    onAccountChange: (accountId: string) => void;
    onDataChange?: () => void;
}

export function SalaryModal({
    visible,
    onHide,
    selectedAccountId,
    accounts,
    onAccountChange,
    onDataChange,
}: SalaryModalProps) {
    const [configs, setConfigs] = useState<SalaryConfig[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingConfig, setEditingConfig] = useState<SalaryConfig | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        grossSalary: '',
        taxRate: '',
        contributionsRate: '',
        otherDeductions: '0',
        startDate: getCurrentYearMonth(),
        endDate: '',
        isActive: true,
        isLinkedToRecurring: true,
    });

    const previewNetSalary = calculateNetSalary(
        parseFloat(formData.grossSalary) || 0,
        parseFloat(formData.taxRate) || 0,
        parseFloat(formData.contributionsRate) || 0,
        parseFloat(formData.otherDeductions) || 0
    );

    const fetchConfigs = useCallback(async () => {
        if (!selectedAccountId) return;
        setIsLoading(true);
        try {
            const result = await getSalaryConfigs(selectedAccountId);
            if (result.success && result.data) setConfigs(result.data);
        } catch (err) {
            console.error('Failed to fetch:', err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        if (visible && selectedAccountId) fetchConfigs();
    }, [visible, selectedAccountId, fetchConfigs]);

    const resetForm = () => {
        setFormData({
            name: '',
            grossSalary: '',
            taxRate: '',
            contributionsRate: '',
            otherDeductions: '0',
            startDate: getCurrentYearMonth(),
            endDate: '',
            isActive: true,
            isLinkedToRecurring: true,
        });
        setEditingConfig(null);
    };

    const openForm = (config?: SalaryConfig) => {
        if (config) {
            setEditingConfig(config);
            setFormData({
                name: config.name,
                grossSalary: config.grossSalary.toString(),
                taxRate: config.taxRate.toString(),
                contributionsRate: config.contributionsRate.toString(),
                otherDeductions: config.otherDeductions.toString(),
                startDate: config.startDate,
                endDate: config.endDate || '',
                isActive: config.isActive,
                isLinkedToRecurring: config.isLinkedToRecurring,
            });
        } else {
            resetForm();
        }
        setIsFormOpen(true);
    };

    const handleSubmit = async () => {
        try {
            const body = {
                name: formData.name,
                grossSalary: parseFloat(formData.grossSalary),
                taxRate: parseFloat(formData.taxRate),
                contributionsRate: parseFloat(formData.contributionsRate),
                otherDeductions: parseFloat(formData.otherDeductions) || 0,
                startDate: formData.startDate,
                endDate: formData.endDate || undefined,
                isActive: formData.isActive,
                isLinkedToRecurring: formData.isLinkedToRecurring,
            };

            const result = editingConfig
                ? await updateSalaryConfig(selectedAccountId, editingConfig.id, body)
                : await createSalaryConfig(selectedAccountId, body);

            if (result.success) {
                await fetchConfigs();
                setIsFormOpen(false);
                resetForm();
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to save:', err);
        }
    };

    const handleDelete = async (configId: string) => {
        if (!confirm('Delete this salary configuration? This will also remove the linked recurring income item.')) return;
        try {
            const result = await deleteSalaryConfig(selectedAccountId, configId);
            if (result.success) {
                setConfigs(prev => prev.filter(c => c.id !== configId));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to delete:', err);
        }
    };

    const handleToggleActive = async (config: SalaryConfig) => {
        try {
            const result = await updateSalaryConfig(selectedAccountId, config.id, { isActive: !config.isActive });
            if (result.success) {
                setConfigs(prev => prev.map(c => c.id === config.id ? { ...c, isActive: !c.isActive } : c));
                onDataChange?.();
            }
        } catch (err) {
            console.error('Failed to toggle:', err);
        }
    };

    const account = accounts.find(a => a.id === selectedAccountId);
    const currency = (account?.currency || 'EUR') as Currency;
    const totalActiveNetSalary = configs.filter(c => c.isActive).reduce((sum, c) => sum + c.netSalary, 0);

    return (
        <Dialog
            header="Salary Calculator"
            visible={visible}
            onHide={onHide}
            style={{ width: '95vw', maxWidth: '1200px' }}
            maximizable
            modal
        >
            <div className="space-y-4">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Dropdown
                        value={selectedAccountId}
                        onChange={(e: DropdownChangeEvent) => onAccountChange(e.value)}
                        options={accounts.filter(a => !a.isArchived).map(a => ({ value: a.id, label: a.name }))}
                        optionLabel="label"
                        optionValue="value"
                        placeholder="Select Account"
                        className="w-48"
                    />
                    <Button label="Add Salary" icon="pi pi-plus" onClick={() => openForm()} />
                </div>

                {/* Summary */}
                <Card className="shadow-sm">
                    <div className="flex items-center justify-between p-4">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Monthly Net Salary</p>
                            <p className="text-3xl font-bold text-green-600">{formatCurrency(totalActiveNetSalary, currency)}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                From {configs.filter(c => c.isActive).length} active configuration(s)
                            </p>
                        </div>
                        <i className="pi pi-calculator text-5xl text-green-600"></i>
                    </div>
                </Card>

                {/* Configs */}
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <ProgressSpinner style={{ width: '40px', height: '40px' }} />
                    </div>
                ) : configs.length === 0 ? (
                    <Card className="shadow-sm">
                        <div className="py-12 text-center text-gray-500">
                            <i className="pi pi-calculator text-5xl mb-4"></i>
                            <p>No salary configurations yet. Click &quot;Add Salary&quot; to create one.</p>
                        </div>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {configs.map((config) => (
                            <Card key={config.id} className={`shadow-sm ${!config.isActive ? 'opacity-60' : ''}`}>
                                <div className="p-4">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h3 className="font-semibold">{config.name}</h3>
                                            <div className="flex items-center gap-2 mt-1">
                                                <Tag value={config.isActive ? 'Active' : 'Inactive'} severity={config.isActive ? 'success' : 'secondary'} />
                                                {config.isLinkedToRecurring && <Tag value="Linked" severity="info" icon="pi pi-link" />}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Button icon={config.isActive ? 'pi pi-check-circle' : 'pi pi-circle'} rounded text
                                                severity={config.isActive ? 'success' : 'secondary'} onClick={() => handleToggleActive(config)} />
                                            <Button icon="pi pi-pencil" rounded text onClick={() => openForm(config)} />
                                            <Button icon="pi pi-trash" rounded text severity="danger" onClick={() => handleDelete(config.id)} />
                                        </div>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Gross Salary</span>
                                            <span className="font-medium">{formatCurrency(config.grossSalary, currency)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Tax Rate</span>
                                            <span className="text-red-600">-{config.taxRate}% ({formatCurrency(config.grossSalary * config.taxRate / 100, currency)})</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Contributions</span>
                                            <span className="text-red-600">-{config.contributionsRate}% ({formatCurrency(config.grossSalary * config.contributionsRate / 100, currency)})</span>
                                        </div>
                                        {config.otherDeductions > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">Other Deductions</span>
                                                <span className="text-red-600">-{formatCurrency(config.otherDeductions, currency)}</span>
                                            </div>
                                        )}
                                        <div className="pt-2 border-t">
                                            <div className="flex justify-between">
                                                <span className="font-medium">Net Salary</span>
                                                <span className="font-bold text-green-600">{formatCurrency(config.netSalary, currency)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Form Dialog */}
            <Dialog
                header={editingConfig ? 'Edit Salary' : 'Add Salary'}
                visible={isFormOpen}
                onHide={() => { setIsFormOpen(false); resetForm(); }}
                style={{ width: '500px' }}
            >
                <div className="space-y-4">
                    <div><label className="text-sm font-medium">Name</label>
                        <InputText placeholder="e.g., Main Job" value={formData.name}
                            onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full" /></div>
                    <div><label className="text-sm font-medium">Gross Salary (Monthly)</label>
                        <InputText type="number" placeholder="0.00" value={formData.grossSalary}
                            onChange={e => setFormData(p => ({ ...p, grossSalary: e.target.value }))} className="w-full" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-sm font-medium">Tax Rate (%)</label>
                            <InputText type="number" placeholder="e.g., 25" value={formData.taxRate}
                                onChange={e => setFormData(p => ({ ...p, taxRate: e.target.value }))} className="w-full" /></div>
                        <div><label className="text-sm font-medium">Contributions (%)</label>
                            <InputText type="number" placeholder="e.g., 10" value={formData.contributionsRate}
                                onChange={e => setFormData(p => ({ ...p, contributionsRate: e.target.value }))} className="w-full" /></div>
                    </div>
                    <div><label className="text-sm font-medium">Other Deductions (Fixed)</label>
                        <InputText type="number" placeholder="0.00" value={formData.otherDeductions}
                            onChange={e => setFormData(p => ({ ...p, otherDeductions: e.target.value }))} className="w-full" /></div>

                    {/* Preview */}
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-500">Calculated Net Salary</span>
                            <span className="text-xl font-bold text-green-600">{formatCurrency(previewNetSalary, currency)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-sm font-medium">Start Date</label>
                            <InputText type="month" value={formData.startDate}
                                onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))} className="w-full" /></div>
                        <div><label className="text-sm font-medium">End Date (opt)</label>
                            <InputText type="month" value={formData.endDate}
                                onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))} className="w-full" /></div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <InputSwitch checked={formData.isActive}
                                onChange={(e: InputSwitchChangeEvent) => setFormData(p => ({ ...p, isActive: e.value ?? false }))} />
                            <label className="text-sm">Active</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <InputSwitch checked={formData.isLinkedToRecurring}
                                onChange={(e: InputSwitchChangeEvent) => setFormData(p => ({ ...p, isLinkedToRecurring: e.value ?? false }))} />
                            <label className="text-sm">Add as recurring income item</label>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button label="Cancel" severity="secondary" outlined onClick={() => { setIsFormOpen(false); resetForm(); }} />
                        <Button label="Save" onClick={handleSubmit} />
                    </div>
                </div>
            </Dialog>
        </Dialog>
    );
}
