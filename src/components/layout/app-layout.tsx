'use client';

import { SessionProvider } from 'next-auth/react';
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarNav } from './sidebar-nav';
import { CommandPalette, useCommandPalette } from '@/components/ui/command-palette';
import { ReconcileWizard } from '@/components/reconcile/reconcile-wizard';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { EntityModalRouter } from '@/components/ui/entity-modal-router';
import { getAccounts } from '@/lib/actions/accounts';
import { getUserPreferences } from '@/lib/actions/user-preferences';
import type { FinancialAccount, DrawerState } from '@/types';

interface AppLayoutProps {
    children: React.ReactNode;
}

// Context to communicate with pages for data refresh and drawer control
interface AppContextValue {
    refreshData: () => void;
    setRefreshCallback: (cb: () => void) => void;
    selectedAccountId: string;
    setSelectedAccountId: (id: string) => void;
    accounts: FinancialAccount[];
    // Drawer control
    drawerState: DrawerState;
    openDrawer: (options: Partial<DrawerState>) => void;
    closeDrawer: () => void;
    // Reconcile wizard
    openReconcile: () => void;
    // Selected month for cashflow
    selectedYearMonth: string;
    setSelectedYearMonth: (ym: string) => void;
    // Sidebar collapsed state
    sidebarCollapsed: boolean;
    setSidebarCollapsed: (collapsed: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
    return useContext(AppContext);
}

const initialDrawerState: DrawerState = {
    isOpen: false,
    mode: 'view',
};

export function AppLayout({ children }: AppLayoutProps) {
    const router = useRouter();
    const commandPalette = useCommandPalette();

    const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [refreshCallback, setRefreshCallback] = useState<(() => void) | null>(null);
    const [drawerState, setDrawerState] = useState<DrawerState>(initialDrawerState);
    const [selectedYearMonth, setSelectedYearMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('sidebar-collapsed') === 'true';
        }
        return false;
    });

    const handleToggleSidebar = useCallback(() => {
        setSidebarCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('sidebar-collapsed', String(next));
            return next;
        });
    }, []);

    // Reconcile wizard state
    const [reconcileVisible, setReconcileVisible] = useState(false);

    // Onboarding wizard state
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        getUserPreferences().then(result => {
            if (result.success && result.data && !result.data.hasCompletedOnboarding) {
                setShowOnboarding(true);
            }
        });
    }, []);

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
        let isMounted = true;
        if (isMounted) {
            fetchAccounts();
        }
        return () => {
            isMounted = false;
        };
    }, [fetchAccounts]);

    const handleDataChange = useCallback(() => {
        fetchAccounts();
        refreshCallback?.();
    }, [fetchAccounts, refreshCallback]);

    const openDrawer = useCallback((options: Partial<DrawerState>) => {
        setDrawerState({
            isOpen: true,
            mode: options.mode || 'view',
            entityType: options.entityType,
            entityId: options.entityId,
            yearMonth: options.yearMonth,
        });
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawerState(initialDrawerState);
    }, []);

    const handleAddItem = (type: 'income' | 'expense', yearMonth?: string) => {
        openDrawer({
            mode: 'create',
            entityType: type === 'income' ? 'income' : 'expense',
            yearMonth: yearMonth || selectedYearMonth,
        });
    };

    const handleOpenReconcile = useCallback(() => {
        setReconcileVisible(true);
    }, []);

    const contextValue: AppContextValue = {
        refreshData: handleDataChange,
        setRefreshCallback: (cb) => setRefreshCallback(() => cb),
        selectedAccountId,
        setSelectedAccountId,
        accounts,
        drawerState,
        openDrawer,
        closeDrawer,
        openReconcile: handleOpenReconcile,
        selectedYearMonth,
        setSelectedYearMonth,
        sidebarCollapsed,
        setSidebarCollapsed,
    };

    return (
        <SessionProvider>
            <AppContext.Provider value={contextValue}>
                <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
                    <SidebarNav
                        onOpenReconcile={() => setReconcileVisible(true)}
                        onOpenCommandPalette={commandPalette.open}
                        collapsed={sidebarCollapsed}
                        onToggleCollapse={handleToggleSidebar}
                    />

                    <main className={`transition-all duration-300 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
                        <div className="max-w-7xl mx-auto px-6 py-8">
                            {children}
                        </div>
                    </main>

                    {/* Command Palette */}
                    <CommandPalette
                        isOpen={commandPalette.isOpen}
                        onClose={commandPalette.close}
                        onNavigate={(path) => router.push(path)}
                        onAddItem={handleAddItem}
                        onReconcile={() => setReconcileVisible(true)}
                    />

                    {/* Entity Modal Router */}
                    <EntityModalRouter
                        drawerState={drawerState}
                        onClose={closeDrawer}
                        onDataChange={handleDataChange}
                        accounts={accounts}
                        selectedAccountId={selectedAccountId}
                        onAccountChange={setSelectedAccountId}
                    />

                    {/* Reconcile Wizard */}
                    <ReconcileWizard
                        visible={reconcileVisible}
                        onHide={() => setReconcileVisible(false)}
                        onComplete={handleDataChange}
                    />

                    {/* Onboarding Wizard */}
                    <OnboardingWizard
                        visible={showOnboarding}
                        onComplete={() => {
                            setShowOnboarding(false);
                            handleDataChange();
                        }}
                    />
                </div>
            </AppContext.Provider>
        </SessionProvider>
    );
}
