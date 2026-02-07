'use client';

import { CashflowItemModal } from '@/components/modals/cashflow-item-modal';
import { UsersModal } from '@/components/modals/users-modal';
import { EntityListDrawer } from '@/components/ui/entity-list-drawer';
import type { DrawerState, FinancialAccount } from '@/types';

interface EntityModalRouterProps {
    drawerState: DrawerState;
    onClose: () => void;
    onDataChange: () => void;
    accounts: FinancialAccount[];
    selectedAccountId: string;
    onAccountChange: (accountId: string) => void;
}

const entityToCategory: Record<string, 'cash' | 'investments' | 'receivables' | 'debts'> = {
    'account': 'cash',
    'cash-account': 'cash',
    'investment': 'investments',
    'receivable': 'receivables',
    'debt': 'debts',
};

export function EntityModalRouter({
    drawerState,
    onClose,
    onDataChange,
    accounts,
    selectedAccountId,
    onAccountChange,
}: EntityModalRouterProps) {
    const visible = drawerState.isOpen;
    const entityType = drawerState.entityType;
    const editItemId = drawerState.mode === 'edit' ? drawerState.entityId : undefined;

    const handleHide = () => {
        onClose();
        onDataChange();
    };

    // Map entity types to the unified cashflow item modal
    const cashflowTypes: Record<string, { type?: 'income' | 'expense'; recurrence?: 'recurring' | 'one-off' | 'salary'; source?: string }> = {
        'income': { type: 'income', recurrence: 'recurring' },
        'expense': { type: 'expense', recurrence: 'recurring' },
        'planned': { recurrence: 'one-off' },
        'salary': { type: 'income', recurrence: 'salary' },
        'cashflow-item': {},
    };

    if (entityType && entityType in cashflowTypes) {
        const cfg = cashflowTypes[entityType];
        return (
            <CashflowItemModal
                visible={visible}
                onHide={handleHide}
                selectedAccountId={selectedAccountId}
                accounts={accounts.filter(a => !a.isArchived)}
                onAccountChange={onAccountChange}
                onDataChange={onDataChange}
                editItemId={editItemId}
                editItemSource={entityType}
                initialType={cfg.type}
                initialRecurrence={cfg.recurrence}
                autoOpenForm={drawerState.mode === 'create'}
            />
        );
    }

    // Entity types handled by EntityListDrawer
    if (entityType && entityType in entityToCategory) {
        const category = entityToCategory[entityType];
        return (
            <EntityListDrawer
                visible={visible}
                category={category}
                onClose={handleHide}
                onRefresh={onDataChange}
                editEntityId={editItemId}
            />
        );
    }

    switch (entityType) {
        case 'users':
            return (
                <UsersModal
                    visible={visible}
                    onHide={handleHide}
                />
            );

        default:
            return null;
    }
}
