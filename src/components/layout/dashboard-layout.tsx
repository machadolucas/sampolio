'use client';

import { SessionProvider } from 'next-auth/react';
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { TopBar } from './topbar';
import { AccountsModal, RecurringModal, PlannedModal, SalaryModal, UsersModal, SettingsModal, InvestmentsModal, DebtsModal, ReceivablesModal } from '@/components/modals';
import { getAccounts } from '@/lib/actions/accounts';
import type { FinancialAccount } from '@/types';

interface DashboardLayoutProps {
    children: React.ReactNode;
}

// Context to communicate with dashboard page for data refresh
interface DashboardContextValue {
    refreshData: () => void;
    setRefreshCallback: (cb: () => void) => void;
    selectedAccountId: string;
    setSelectedAccountId: (id: string) => void;
    accounts: FinancialAccount[];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboardContext() {
    return useContext(DashboardContext);
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [refreshCallback, setRefreshCallback] = useState<(() => void) | null>(null);

    // Modal visibility states
    const [accountsVisible, setAccountsVisible] = useState(false);
    const [recurringVisible, setRecurringVisible] = useState(false);
    const [plannedVisible, setPlannedVisible] = useState(false);
    const [salaryVisible, setSalaryVisible] = useState(false);
    const [usersVisible, setUsersVisible] = useState(false);
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [investmentsVisible, setInvestmentsVisible] = useState(false);
    const [debtsVisible, setDebtsVisible] = useState(false);
    const [receivablesVisible, setReceivablesVisible] = useState(false);

    // Fetch accounts
    const fetchAccounts = useCallback(async () => {
        try {
            const result = await getAccounts();
            if (result.success && result.data) {
                const activeAccounts = result.data.filter((a: FinancialAccount) => !a.isArchived);
                setAccounts(result.data);
                if (activeAccounts.length > 0 && !selectedAccountId) {
                    setSelectedAccountId(activeAccounts[0].id);
                }
            }
        } catch (err) {
            console.error('Failed to fetch accounts:', err);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    const handleDataChange = useCallback(() => {
        fetchAccounts();
        refreshCallback?.();
    }, [fetchAccounts, refreshCallback]);

    const handleAccountChange = (accountId: string) => {
        setSelectedAccountId(accountId);
    };

    // Check if there are any non-archived accounts
    const activeAccounts = accounts.filter(a => !a.isArchived);
    const hasActiveAccounts = activeAccounts.length > 0;

    const contextValue: DashboardContextValue = {
        refreshData: handleDataChange,
        setRefreshCallback: (cb) => setRefreshCallback(() => cb),
        selectedAccountId,
        setSelectedAccountId,
        accounts,
    };

    return (
        <SessionProvider>
            <DashboardContext.Provider value={contextValue}>
                <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
                    <TopBar
                        onOpenAccounts={() => setAccountsVisible(true)}
                        onOpenRecurring={() => setRecurringVisible(true)}
                        onOpenPlanned={() => setPlannedVisible(true)}
                        onOpenSalary={() => setSalaryVisible(true)}
                        onOpenInvestments={() => setInvestmentsVisible(true)}
                        onOpenDebts={() => setDebtsVisible(true)}
                        onOpenReceivables={() => setReceivablesVisible(true)}
                        onOpenUsers={() => setUsersVisible(true)}
                        onOpenSettings={() => setSettingsVisible(true)}
                        hasActiveAccounts={hasActiveAccounts}
                    />
                    <main className="pt-16">
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                            {children}
                        </div>
                    </main>

                    {/* Modals */}
                    <AccountsModal
                        visible={accountsVisible}
                        onHide={() => setAccountsVisible(false)}
                        onAccountChange={handleDataChange}
                    />
                    <RecurringModal
                        visible={recurringVisible}
                        onHide={() => setRecurringVisible(false)}
                        selectedAccountId={selectedAccountId}
                        accounts={accounts.filter(a => !a.isArchived)}
                        onAccountChange={handleAccountChange}
                        onDataChange={handleDataChange}
                    />
                    <PlannedModal
                        visible={plannedVisible}
                        onHide={() => setPlannedVisible(false)}
                        selectedAccountId={selectedAccountId}
                        accounts={accounts.filter(a => !a.isArchived)}
                        onAccountChange={handleAccountChange}
                        onDataChange={handleDataChange}
                    />
                    <SalaryModal
                        visible={salaryVisible}
                        onHide={() => setSalaryVisible(false)}
                        selectedAccountId={selectedAccountId}
                        accounts={accounts.filter(a => !a.isArchived)}
                        onAccountChange={handleAccountChange}
                        onDataChange={handleDataChange}
                    />
                    <UsersModal
                        visible={usersVisible}
                        onHide={() => setUsersVisible(false)}
                    />
                    <SettingsModal
                        visible={settingsVisible}
                        onHide={() => setSettingsVisible(false)}
                    />
                    <InvestmentsModal
                        visible={investmentsVisible}
                        onHide={() => setInvestmentsVisible(false)}
                        onDataChange={handleDataChange}
                    />
                    <DebtsModal
                        visible={debtsVisible}
                        onHide={() => setDebtsVisible(false)}
                        onDataChange={handleDataChange}
                    />
                    <ReceivablesModal
                        visible={receivablesVisible}
                        onHide={() => setReceivablesVisible(false)}
                        onDataChange={handleDataChange}
                    />
                </div>
            </DashboardContext.Provider>
        </SessionProvider>
    );
}
