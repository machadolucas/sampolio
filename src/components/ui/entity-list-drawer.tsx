'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from 'primereact/button';
import { ProgressSpinner } from 'primereact/progressspinner';
import { useTheme } from '@/components/providers/theme-provider';
import { useAppContext } from '@/components/layout/app-layout';
import { formatCurrency } from '@/lib/constants';
import { getAccounts } from '@/lib/actions/accounts';
import { getInvestmentAccounts } from '@/lib/actions/investments';
import { getReceivables } from '@/lib/actions/receivables';
import { getDebts } from '@/lib/actions/debts';
import type { FinancialAccount, InvestmentAccount, Receivable, Debt, Currency } from '@/types';

type EntityCategory = 'cash' | 'investments' | 'receivables' | 'debts';

interface EntityListDrawerProps {
    visible: boolean;
    category: EntityCategory;
    onClose: () => void;
    onRefresh?: () => void;
}

const categoryConfig = {
    cash: { title: 'Cash Accounts', icon: 'pi pi-wallet', entityType: 'account', color: 'text-green-500' },
    investments: { title: 'Investments', icon: 'pi pi-chart-bar', entityType: 'investment', color: 'text-blue-500' },
    receivables: { title: 'Receivables', icon: 'pi pi-users', entityType: 'receivable', color: 'text-yellow-500' },
    debts: { title: 'Debts', icon: 'pi pi-credit-card', entityType: 'debt', color: 'text-red-500' },
};

interface EntityItem {
    id: string;
    name: string;
    value: number;
    currency: Currency;
    subtitle: string;
    entityType: string;
}

export function EntityListDrawer({ visible, category, onClose, onRefresh }: EntityListDrawerProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const appContext = useAppContext();
    const [items, setItems] = useState<EntityItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const config = categoryConfig[category];

    const fetchItems = useCallback(async () => {
        setIsLoading(true);
        try {
            let entities: EntityItem[] = [];
            switch (category) {
                case 'cash': {
                    const res = await getAccounts();
                    if (res.success && res.data) {
                        entities = res.data
                            .filter((a: FinancialAccount) => !a.isArchived)
                            .map((a: FinancialAccount) => ({
                                id: a.id,
                                name: a.name,
                                value: a.startingBalance,
                                currency: a.currency,
                                subtitle: `Since ${a.startingDate}`,
                                entityType: 'cash-account',
                            }));
                    }
                    break;
                }
                case 'investments': {
                    const res = await getInvestmentAccounts();
                    if (res.success && res.data) {
                        entities = res.data
                            .filter((i: InvestmentAccount) => !i.isArchived)
                            .map((i: InvestmentAccount) => ({
                                id: i.id,
                                name: i.name,
                                value: i.currentValuation || i.startingValuation,
                                currency: i.currency,
                                subtitle: `${i.annualGrowthRate}% annual growth`,
                                entityType: 'investment',
                            }));
                    }
                    break;
                }
                case 'receivables': {
                    const res = await getReceivables();
                    if (res.success && res.data) {
                        entities = res.data
                            .filter((r: Receivable) => !r.isArchived)
                            .map((r: Receivable) => ({
                                id: r.id,
                                name: r.name,
                                value: r.currentBalance,
                                currency: r.currency,
                                subtitle: r.description || `Started ${r.startDate}`,
                                entityType: 'receivable',
                            }));
                    }
                    break;
                }
                case 'debts': {
                    const res = await getDebts();
                    if (res.success && res.data) {
                        entities = res.data
                            .filter((d: Debt) => !d.isArchived)
                            .map((d: Debt) => ({
                                id: d.id,
                                name: d.name,
                                value: d.currentPrincipal,
                                currency: d.currency,
                                subtitle: d.description || `${d.debtType} - ${d.interestModelType}`,
                                entityType: 'debt',
                            }));
                    }
                    break;
                }
            }
            setItems(entities);
        } catch (err) {
            console.error('Failed to fetch entities:', err);
        } finally {
            setIsLoading(false);
        }
    }, [category]);

    useEffect(() => {
        if (visible) fetchItems();
    }, [visible, fetchItems]);

    if (!visible) return null;

    const total = items.reduce((sum, item) => sum + item.value, 0);
    const isLiability = category === 'debts';

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/30 z-40 transition-opacity"
                onClick={onClose}
            />

            {/* Drawer */}
            <div
                className={`fixed right-0 top-0 h-screen w-[28rem] z-50 flex flex-col shadow-xl transition-transform ${
                    isDark ? 'bg-gray-900 border-l border-gray-700' : 'bg-white border-l border-gray-200'
                }`}
            >
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                        <i className={`${config.icon} text-xl ${config.color}`} />
                        <div>
                            <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                {config.title}
                            </h2>
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                {items.length} item{items.length !== 1 ? 's' : ''} · Total: {isLiability ? '-' : ''}{formatCurrency(total, 'EUR')}
                            </p>
                        </div>
                    </div>
                    <Button icon="pi pi-times" rounded text severity="secondary" onClick={onClose} />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {isLoading ? (
                        <div className="flex justify-center py-12">
                            <ProgressSpinner style={{ width: '40px', height: '40px' }} />
                        </div>
                    ) : items.length === 0 ? (
                        <div className={`text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            <i className={`${config.icon} text-4xl mb-4`} />
                            <p className="mb-4">No {config.title.toLowerCase()} yet</p>
                            <Button
                                label={`Add ${config.title.replace(/s$/, '')}`}
                                icon="pi pi-plus"
                                onClick={() => {
                                    appContext?.openDrawer({ mode: 'create', entityType: config.entityType });
                                }}
                            />
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {items.map((item) => (
                                <div
                                    key={item.id}
                                    className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-colors ${
                                        isDark ? 'bg-gray-800 hover:bg-gray-750' : 'bg-gray-50 hover:bg-gray-100'
                                    }`}
                                    onClick={() => {
                                        appContext?.openDrawer({
                                            mode: 'edit',
                                            entityType: item.entityType,
                                            entityId: item.id,
                                        });
                                    }}
                                >
                                    <div>
                                        <h3 className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                                            {item.name}
                                        </h3>
                                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {item.subtitle}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className={`font-semibold ${isLiability ? 'text-red-500' : 'text-green-500'}`}>
                                            {isLiability ? '-' : ''}{formatCurrency(item.value, item.currency)}
                                        </p>
                                        <i className={`pi pi-chevron-right text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={`px-6 py-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    <Button
                        label={`Add ${config.title.replace(/s$/, '')}`}
                        icon="pi pi-plus"
                        className="w-full"
                        onClick={() => {
                            appContext?.openDrawer({ mode: 'create', entityType: config.entityType });
                        }}
                    />
                </div>
            </div>
        </>
    );
}
