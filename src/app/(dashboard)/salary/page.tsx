'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Dropdown, DropdownChangeEvent } from 'primereact/dropdown';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputSwitch, InputSwitchChangeEvent } from 'primereact/inputswitch';
import { ProgressSpinner } from 'primereact/progressspinner';
import { formatCurrency } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
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

export default function SalaryPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [configs, setConfigs] = useState<SalaryConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingConfig, setEditingConfig] = useState<SalaryConfig | null>(null);

    // Form state
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

    // Calculated net salary preview
    const previewNetSalary = calculateNetSalary(
        parseFloat(formData.grossSalary) || 0,
        parseFloat(formData.taxRate) || 0,
        parseFloat(formData.contributionsRate) || 0,
        parseFloat(formData.otherDeductions) || 0
    );

    // Fetch accounts
    useEffect(() => {
        async function fetchAccounts() {
            try {
                const res = await fetch('/api/accounts');
                const data = await res.json();
                if (data.success) {
                    const activeAccounts = data.data.filter((a: FinancialAccount) => !a.isArchived);
                    setAccounts(activeAccounts);
                    if (activeAccounts.length > 0 && !selectedAccountId) {
                        setSelectedAccountId(activeAccounts[0].id);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch accounts:', err);
            } finally {
                setIsLoading(false);
            }
        }
        fetchAccounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch salary configs when account changes
    const fetchConfigs = useCallback(async () => {
        if (!selectedAccountId) return;

        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/salary`);
            const data = await res.json();
            if (data.success) {
                setConfigs(data.data);
            }
        } catch (err) {
            console.error('Failed to fetch salary configs:', err);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        fetchConfigs();
    }, [fetchConfigs]);

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

    const openModal = (config?: SalaryConfig) => {
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
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

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

            const url = editingConfig
                ? `/api/accounts/${selectedAccountId}/salary/${editingConfig.id}`
                : `/api/accounts/${selectedAccountId}/salary`;

            const res = await fetch(url, {
                method: editingConfig ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (data.success) {
                await fetchConfigs();
                setIsModalOpen(false);
                resetForm();
            }
        } catch (err) {
            console.error('Failed to save config:', err);
        }
    };

    const handleDelete = async (configId: string) => {
        if (!confirm('Are you sure you want to delete this salary configuration? This will also remove the linked recurring income item.')) return;

        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/salary/${configId}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                setConfigs(prev => prev.filter(c => c.id !== configId));
            }
        } catch (err) {
            console.error('Failed to delete config:', err);
        }
    };

    const handleToggleActive = async (config: SalaryConfig) => {
        try {
            const res = await fetch(`/api/accounts/${selectedAccountId}/salary/${config.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !config.isActive }),
            });
            const data = await res.json();
            if (data.success) {
                setConfigs(prev => prev.map(c => c.id === config.id ? { ...c, isActive: !c.isActive } : c));
            }
        } catch (err) {
            console.error('Failed to toggle config:', err);
        }
    };

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const currency = (selectedAccount?.currency || 'EUR') as Currency;

    const totalActiveNetSalary = configs
        .filter(c => c.isActive)
        .reduce((sum, c) => sum + c.netSalary, 0);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <ProgressSpinner style={{ width: '50px', height: '50px' }} />
            </div>
        );
    }

    if (accounts.length === 0) {
        return (
            <div className="text-center py-16">
                <i className="pi pi-calculator text-6xl text-gray-400 mb-4"></i>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    No accounts yet
                </h2>
                <p className="text-gray-600 mb-6">
                    Create a financial account first to configure salaries
                </p>
                <Button label="Create Account" icon="pi pi-plus" onClick={() => router.push('/accounts/new')} />
            </div>
        );
    }

    const dialogFooter = (
        <div className="flex justify-end gap-3 pt-4">
            <Button
                label="Cancel"
                severity="secondary"
                outlined
                onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                }}
            />
            <Button
                label={editingConfig ? 'Save Changes' : 'Add Salary'}
                type="submit"
                onClick={handleSubmit}
            />
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Salary Calculator</h1>
                    <p className="text-gray-600">
                        Calculate net salary and automatically add as recurring income
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Dropdown
                        value={selectedAccountId}
                        onChange={(e: DropdownChangeEvent) => setSelectedAccountId(e.value)}
                        options={accounts.map(a => ({ value: a.id, label: a.name }))}
                        optionLabel="label"
                        optionValue="value"
                        placeholder="Select Account"
                        className="w-48"
                    />
                    <Button label="Add Salary" icon="pi pi-plus" onClick={() => openModal()} />
                </div>
            </div>

            {/* Summary Card */}
            <Card className="shadow-sm">
                <div className="flex items-center justify-between p-4">
                    <div>
                        <p className="text-sm text-gray-500">Total Monthly Net Salary</p>
                        <p className="text-3xl font-bold text-green-600">
                            {formatCurrency(totalActiveNetSalary, currency)}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                            From {configs.filter(c => c.isActive).length} active salary configuration(s)
                        </p>
                    </div>
                    <i className="pi pi-calculator text-5xl text-green-600"></i>
                </div>
            </Card>

            {/* Salary Configs List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {configs.map((config) => (
                    <Card key={config.id} className={`shadow-sm ${!config.isActive ? 'opacity-60' : ''}`}>
                        <div className="p-4">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="font-semibold text-gray-900">{config.name}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Tag
                                            value={config.isActive ? 'Active' : 'Inactive'}
                                            severity={config.isActive ? 'success' : 'secondary'}
                                        />
                                        {config.isLinkedToRecurring && (
                                            <Tag value="Linked" severity="info" icon="pi pi-link" />
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        icon={config.isActive ? 'pi pi-check-circle' : 'pi pi-circle'}
                                        rounded
                                        text
                                        severity={config.isActive ? 'success' : 'secondary'}
                                        onClick={() => handleToggleActive(config)}
                                        tooltip={config.isActive ? 'Deactivate' : 'Activate'}
                                    />
                                    <Button
                                        icon="pi pi-pencil"
                                        rounded
                                        text
                                        onClick={() => openModal(config)}
                                    />
                                    <Button
                                        icon="pi pi-trash"
                                        rounded
                                        text
                                        severity="danger"
                                        onClick={() => handleDelete(config.id)}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Gross Salary</span>
                                    <span className="font-medium text-gray-900">
                                        {formatCurrency(config.grossSalary, currency)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Tax Rate</span>
                                    <span className="text-red-600">
                                        -{config.taxRate}% ({formatCurrency(config.grossSalary * config.taxRate / 100, currency)})
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Contributions</span>
                                    <span className="text-red-600">
                                        -{config.contributionsRate}% ({formatCurrency(config.grossSalary * config.contributionsRate / 100, currency)})
                                    </span>
                                </div>
                                {config.otherDeductions > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Other Deductions</span>
                                        <span className="text-red-600">
                                            -{formatCurrency(config.otherDeductions, currency)}
                                        </span>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-gray-200">
                                    <div className="flex justify-between">
                                        <span className="font-medium text-gray-900">Net Salary</span>
                                        <span className="font-bold text-green-600">
                                            {formatCurrency(config.netSalary, currency)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}

                {configs.length === 0 && (
                    <Card className="col-span-full shadow-sm">
                        <div className="py-16 text-center">
                            <i className="pi pi-calculator text-5xl text-gray-400 mb-4"></i>
                            <p className="text-gray-500">
                                No salary configurations yet. Click &quot;Add Salary&quot; to create one.
                            </p>
                        </div>
                    </Card>
                )}
            </div>

            {/* Add/Edit Dialog */}
            <Dialog
                visible={isModalOpen}
                onHide={() => {
                    setIsModalOpen(false);
                    resetForm();
                }}
                header={editingConfig ? 'Edit Salary Configuration' : 'Add Salary Configuration'}
                style={{ width: '500px' }}
                footer={dialogFooter}
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex flex-col gap-2">
                        <label htmlFor="name" className="font-medium text-sm">Name</label>
                        <InputText
                            id="name"
                            placeholder="e.g., Main Job, Freelance"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="grossSalary" className="font-medium text-sm">Gross Salary (Monthly)</label>
                        <InputText
                            id="grossSalary"
                            type="number"
                            placeholder="0.00"
                            value={formData.grossSalary}
                            onChange={(e) => setFormData(prev => ({ ...prev, grossSalary: e.target.value }))}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label htmlFor="taxRate" className="font-medium text-sm">Tax Rate (%)</label>
                            <InputText
                                id="taxRate"
                                type="number"
                                placeholder="e.g., 25"
                                value={formData.taxRate}
                                onChange={(e) => setFormData(prev => ({ ...prev, taxRate: e.target.value }))}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label htmlFor="contributionsRate" className="font-medium text-sm">Contributions Rate (%)</label>
                            <InputText
                                id="contributionsRate"
                                type="number"
                                placeholder="e.g., 10"
                                value={formData.contributionsRate}
                                onChange={(e) => setFormData(prev => ({ ...prev, contributionsRate: e.target.value }))}
                                required
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="otherDeductions" className="font-medium text-sm">Other Deductions (Fixed Amount)</label>
                        <InputText
                            id="otherDeductions"
                            type="number"
                            placeholder="0.00"
                            value={formData.otherDeductions}
                            onChange={(e) => setFormData(prev => ({ ...prev, otherDeductions: e.target.value }))}
                        />
                    </div>

                    {/* Preview */}
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-500">Calculated Net Salary</span>
                            <span className="text-xl font-bold text-green-600">
                                {formatCurrency(previewNetSalary, currency)}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label htmlFor="startDate" className="font-medium text-sm">Start Date</label>
                            <InputText
                                id="startDate"
                                type="month"
                                value={formData.startDate}
                                onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label htmlFor="endDate" className="font-medium text-sm">End Date (optional)</label>
                            <InputText
                                id="endDate"
                                type="month"
                                value={formData.endDate}
                                onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <InputSwitch
                                checked={formData.isActive}
                                onChange={(e: InputSwitchChangeEvent) => setFormData(prev => ({ ...prev, isActive: e.value ?? false }))}
                            />
                            <label className="text-sm">Active</label>
                        </div>

                        <div className="flex items-center gap-2">
                            <InputSwitch
                                checked={formData.isLinkedToRecurring}
                                onChange={(e: InputSwitchChangeEvent) => setFormData(prev => ({ ...prev, isLinkedToRecurring: e.value ?? false }))}
                            />
                            <label className="text-sm">Add as recurring income item</label>
                        </div>
                    </div>
                </form>
            </Dialog>
        </div>
    );
}
