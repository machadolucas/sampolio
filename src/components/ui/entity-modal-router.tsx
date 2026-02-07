'use client';

import { AccountsModalContent } from '@/components/modals/accounts-modal';
import { RecurringModal } from '@/components/modals/recurring-modal';
import { PlannedModal } from '@/components/modals/planned-modal';
import { SalaryModal } from '@/components/modals/salary-modal';
import { InvestmentsModalContent } from '@/components/modals/investments-modal';
import { DebtsModalContent } from '@/components/modals/debts-modal';
import { ReceivablesModalContent } from '@/components/modals/receivables-modal';
import { UsersModal } from '@/components/modals/users-modal';
import type { DrawerState, FinancialAccount } from '@/types';

interface EntityModalRouterProps {
    drawerState: DrawerState;
    onClose: () => void;
    onDataChange: () => void;
    accounts: FinancialAccount[];
    selectedAccountId: string;
    onAccountChange: (accountId: string) => void;
}

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

    switch (entityType) {
        case 'account':
        case 'cash-account':
            return (
                <AccountsModalContent
                    visible={visible}
                    onHide={handleHide}
                    onAccountChange={onDataChange}
                    selectedAccountId={selectedAccountId}
                    onSelectAccount={onAccountChange}
                />
            );

        case 'income':
            return (
                <RecurringModal
                    visible={visible}
                    onHide={handleHide}
                    selectedAccountId={selectedAccountId}
                    accounts={accounts.filter(a => !a.isArchived)}
                    onAccountChange={onAccountChange}
                    onDataChange={onDataChange}
                    editItemId={editItemId}
                />
            );

        case 'expense':
            return (
                <RecurringModal
                    visible={visible}
                    onHide={handleHide}
                    selectedAccountId={selectedAccountId}
                    accounts={accounts.filter(a => !a.isArchived)}
                    onAccountChange={onAccountChange}
                    onDataChange={onDataChange}
                    editItemId={editItemId}
                />
            );

        case 'planned':
            return (
                <PlannedModal
                    visible={visible}
                    onHide={handleHide}
                    selectedAccountId={selectedAccountId}
                    accounts={accounts.filter(a => !a.isArchived)}
                    onAccountChange={onAccountChange}
                    onDataChange={onDataChange}
                    editItemId={editItemId}
                />
            );

        case 'salary':
            return (
                <SalaryModal
                    visible={visible}
                    onHide={handleHide}
                    selectedAccountId={selectedAccountId}
                    accounts={accounts.filter(a => !a.isArchived)}
                    onAccountChange={onAccountChange}
                    onDataChange={onDataChange}
                    editItemId={editItemId}
                />
            );

        case 'investment':
            return (
                <InvestmentsModalContent
                    visible={visible}
                    onHide={handleHide}
                    onDataChange={onDataChange}
                />
            );

        case 'receivable':
            return (
                <ReceivablesModalContent
                    visible={visible}
                    onHide={handleHide}
                    onDataChange={onDataChange}
                />
            );

        case 'debt':
            return (
                <DebtsModalContent
                    visible={visible}
                    onHide={handleHide}
                    onDataChange={onDataChange}
                />
            );

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
