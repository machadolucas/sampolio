'use client';

import { useState, useMemo } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { formatCurrency } from '@/lib/constants';
import { runScenarioProjection } from '@/lib/actions/scenario';
import type { MonthlyProjection, Currency, FinancialAccount } from '@/types';
import { MdPlayArrow, MdAdd, MdRemove, MdTrendingUp, MdRefresh } from 'react-icons/md';

type ScenarioTemplate = 'raise' | 'add-expense' | 'remove-expense' | 'extra-savings';

const TEMPLATES: { label: string; value: ScenarioTemplate; description: string }[] = [
    { label: 'Get a raise', value: 'raise', description: 'See the impact of earning more' },
    { label: 'Add an expense', value: 'add-expense', description: 'What if you add a new regular cost?' },
    { label: 'Cancel a subscription', value: 'remove-expense', description: 'How much would you save annually?' },
    { label: 'Start saving', value: 'extra-savings', description: 'Start putting aside money each month' },
];

export default function PlaygroundPage() {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const appContext = useAppContext();
    const accounts = useMemo(() =>
        (appContext?.accounts || []).filter((a: FinancialAccount) => !a.isArchived),
        [appContext?.accounts]
    );

    const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || '');
    const [selectedTemplate, setSelectedTemplate] = useState<ScenarioTemplate>('raise');
    const [isRunning, setIsRunning] = useState(false);

    // Scenario inputs
    const [scenarioName, setScenarioName] = useState('');
    const [scenarioAmount, setScenarioAmount] = useState<number>(0);
    const [scenarioFrequency, setScenarioFrequency] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');

    // Results
    const [result, setResult] = useState<{
        current: MonthlyProjection[];
        modified: MonthlyProjection[];
        summary: { currentEndBalance: number; modifiedEndBalance: number; difference: number; monthsProjected: number };
    } | null>(null);

    const selectedAccount = accounts.find((a: FinancialAccount) => a.id === selectedAccountId);
    const currency = (selectedAccount?.currency || 'EUR') as Currency;

    const handleRun = async () => {
        if (!selectedAccountId || !scenarioAmount) return;
        setIsRunning(true);
        try {
            const modType = selectedTemplate === 'raise' ? 'add-income'
                : selectedTemplate === 'remove-expense' ? 'remove-item'
                    : selectedTemplate === 'extra-savings' ? 'add-expense' // savings is an expense to yourself
                        : 'add-expense';

            // For "cancel subscription", we'd need to select an existing item
            // For now, all templates add/modify a recurring amount
            const res = await runScenarioProjection(selectedAccountId, [{
                type: modType === 'remove-item' ? 'add-income' : modType, // simplified: treat removal as adding inverse
                name: scenarioName || TEMPLATES.find(t => t.value === selectedTemplate)?.label || 'Scenario',
                amount: scenarioAmount,
                frequency: scenarioFrequency,
            }]);

            if (res.success && res.data) {
                setResult(res.data);
            }
        } finally {
            setIsRunning(false);
        }
    };

    const handleReset = () => {
        setResult(null);
        setScenarioAmount(0);
        setScenarioName('');
    };

    return (
        <div className="space-y-6 max-w-360 mx-auto py-8">
            <div>
                <h1 className={`text-4xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    What If?
                </h1>
                <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Explore how changes to your finances would affect your future balance
                </p>
            </div>

            {/* Account selector */}
            {accounts.length > 1 && (
                <Dropdown
                    value={selectedAccountId}
                    options={accounts.map((a: FinancialAccount) => ({ label: a.name, value: a.id }))}
                    onChange={(e) => { setSelectedAccountId(e.value); setResult(null); }}
                    className="w-full md:w-64"
                    placeholder="Select account"
                />
            )}

            {/* Scenario templates */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {TEMPLATES.map(template => (
                    <button
                        key={template.value}
                        onClick={() => { setSelectedTemplate(template.value); setResult(null); }}
                        className={`p-4 rounded-lg border-2 text-left transition-colors ${selectedTemplate === template.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <p className={`font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            {template.label}
                        </p>
                        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {template.description}
                        </p>
                    </button>
                ))}
            </div>

            {/* Input form */}
            <Card>
                <div className="space-y-4">
                    <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {TEMPLATES.find(t => t.value === selectedTemplate)?.label}
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                Name (optional)
                            </label>
                            <InputText
                                value={scenarioName}
                                onChange={e => setScenarioName(e.target.value)}
                                placeholder="e.g. Netflix, Gym membership"
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                Amount
                            </label>
                            <InputNumber
                                value={scenarioAmount}
                                onValueChange={e => setScenarioAmount(e.value ?? 0)}
                                mode="currency"
                                currency={currency}
                                locale="fi-FI"
                                min={0}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                Frequency
                            </label>
                            <SelectButton
                                value={scenarioFrequency}
                                options={[
                                    { label: 'Monthly', value: 'monthly' },
                                    { label: 'Quarterly', value: 'quarterly' },
                                    { label: 'Yearly', value: 'yearly' },
                                ]}
                                onChange={e => setScenarioFrequency(e.value)}
                                className="w-full"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <Button
                            label="Run Scenario"
                            icon={<MdPlayArrow />}
                            onClick={handleRun}
                            loading={isRunning}
                            disabled={!selectedAccountId || !scenarioAmount}
                        />
                        {result && (
                            <Button
                                label="Reset"
                                icon={<MdRefresh />}
                                severity="secondary"
                                text
                                onClick={handleReset}
                            />
                        )}
                    </div>
                </div>
            </Card>

            {/* Results */}
            {isRunning && (
                <div className="flex items-center justify-center py-12">
                    <ProgressSpinner style={{ width: '50px', height: '50px' }} />
                </div>
            )}

            {result && !isRunning && (
                <div className="space-y-6">
                    {/* Key metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card>
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Current End Balance</p>
                            <p className={`text-2xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                {formatCurrency(result.summary.currentEndBalance, currency)}
                            </p>
                        </Card>
                        <Card>
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Modified End Balance</p>
                            <p className={`text-2xl font-bold mt-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                {formatCurrency(result.summary.modifiedEndBalance, currency)}
                            </p>
                        </Card>
                        <Card>
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Difference</p>
                            <p className={`text-2xl font-bold mt-1 ${result.summary.difference >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {result.summary.difference >= 0 ? '+' : ''}{formatCurrency(result.summary.difference, currency)}
                            </p>
                            <Tag
                                value={`Over ${result.summary.monthsProjected} months`}
                                severity="info"
                                className="mt-2"
                            />
                        </Card>
                    </div>

                    {/* Monthly comparison */}
                    <Card>
                        <h3 className={`font-semibold mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            <MdTrendingUp className="inline mr-2" />
                            Monthly Comparison (first 12 months)
                        </h3>
                        <div className="overflow-x-auto">
                            <table className={`w-full text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                <thead>
                                    <tr className={`border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                                        <th className="text-left py-2">Month</th>
                                        <th className="text-right py-2">Current</th>
                                        <th className="text-right py-2">Modified</th>
                                        <th className="text-right py-2">Diff</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.current.slice(0, 12).map((month, i) => {
                                        const mod = result.modified[i];
                                        const diff = (mod?.endingBalance ?? 0) - month.endingBalance;
                                        return (
                                            <tr key={month.yearMonth} className={`border-b ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
                                                <td className="py-2">{month.yearMonth}</td>
                                                <td className="text-right">{formatCurrency(month.endingBalance, currency)}</td>
                                                <td className="text-right">{formatCurrency(mod?.endingBalance ?? 0, currency)}</td>
                                                <td className={`text-right font-medium ${diff >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                    {diff >= 0 ? '+' : ''}{formatCurrency(diff, currency)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
