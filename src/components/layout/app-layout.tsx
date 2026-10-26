'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  createContext,
  useContext,
  startTransition,
} from 'react';
import {
  useDeviceBoolean,
  useDevicePreferencesReady,
} from '@/lib/hooks/use-device-boolean';
import { useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { SidebarNav } from './sidebar-nav';
import { MobileTopBar } from './mobile-top-bar';
import { BottomNav } from './bottom-nav';
import { MobileNavDrawer } from './mobile-nav-drawer';
import {
  CommandPalette,
  useCommandPalette,
} from '@/components/ui/command-palette';
import { EntityModalRouter } from '@/components/ui/entity-modal-router';
import { DelayedSpinner } from '@/components/ui/delayed-loading';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/providers/toast-provider';
import { CelebrationProvider } from '@/components/providers/celebration-provider';
import { CheckinNotifier } from '@/components/providers/checkin-notifier';
import { getAccounts } from '@/lib/actions/accounts';
import { getUserPreferences } from '@/lib/actions/user-preferences';
import { MdAdd, MdVisibilityOff } from 'react-icons/md';
import { setDemoMask, DEMO_MODE_STORAGE_KEY } from '@/lib/demo-mode';
import {
  notifyDataChanged,
  useDataRefresh,
} from '@/lib/hooks/use-data-refresh';
import type { FinancialAccount, DrawerState, DisplayMode } from '@/types';

// Both wizards are large and rarely open — lazy-load them out of the shared
// first-load bundle (same pattern as EntityModalRouter's modals) and mount
// each only once it has been opened (see `reconcileMounted`/`onboardingMounted`).
const wizardLoading = () => (
  <DelayedSpinner className="fixed inset-0 z-50 flex items-center justify-center" />
);
const ReconcileWizard = dynamic(
  () =>
    import('@/components/reconcile/reconcile-wizard').then(
      (m) => m.ReconcileWizard,
    ),
  { ssr: false, loading: wizardLoading },
);
const OnboardingWizard = dynamic(
  () =>
    import('@/components/onboarding/onboarding-wizard').then(
      (m) => m.OnboardingWizard,
    ),
  { ssr: false, loading: wizardLoading },
);

interface AppLayoutProps {
  children: React.ReactNode;
}

// Context to communicate with pages for data refresh and drawer control
interface AppContextValue {
  /** Announce a successful mutation: refetches every mounted data view (see
   * `useDataRefresh` in src/lib/hooks/use-data-refresh.ts). */
  refreshData: () => void;
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  accounts: FinancialAccount[];
  /** True once the first accounts fetch has settled (success or failure). */
  accountsLoaded: boolean;
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
  // Display mode
  displayMode: DisplayMode;
  setDisplayMode: (mode: DisplayMode) => void;
  // Custom mobile bottom-nav tab ids (null = not customized ⇒ per-mode defaults).
  // Unlike setDisplayMode this setter does NOT persist: the Settings card owns
  // the write, because it needs the ApiResponse for rollback + a toast (and
  // AppLayout sits above ToastProvider, so it cannot toast).
  bottomNavIds: string[] | null;
  setBottomNavIds: (ids: string[] | null) => void;
  // Demo mode (UI-only monetary masking for showing the app to friends)
  demoMode: boolean;
  /** Whether values render masked right now (mirrors `demoMode`). */
  demoMasked: boolean;
  setDemoMode: (on: boolean) => void;
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

  // Reconcile wizard state
  const [reconcileVisible, setReconcileVisible] = useState(false);
  const handleOpenReconcile = useCallback(() => {
    setReconcileVisible(true);
  }, []);

  // Mobile nav drawer (opened by the top-bar hamburger and the bottom-nav "More")
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [drawerState, setDrawerState] =
    useState<DrawerState>(initialDrawerState);
  const [selectedYearMonth, setSelectedYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const preferencesReady = useDevicePreferencesReady();
  const [sidebarCollapsed, setSidebarCollapsed] =
    useDeviceBoolean('sidebar-collapsed');
  const [demoMode, setDemoMode] = useDeviceBoolean(DEMO_MODE_STORAGE_KEY, '1');

  const openDrawer = useCallback((options: Partial<DrawerState>) => {
    setDrawerState({
      isOpen: true,
      mode: options.mode || 'view',
      entityType: options.entityType,
      entityId: options.entityId,
      yearMonth: options.yearMonth,
      accountId: options.accountId,
    });
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerState(initialDrawerState);
  }, []);

  // AppLayout persists across route changes, so an entity modal / wizard /
  // nav drawer opened on one page would otherwise survive navigation and sit
  // (with its blocking mask) over the next page — the "stuck modal after
  // going back" bug. Close every layout-owned overlay whenever the route
  // actually changes.
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    setDrawerState(initialDrawerState);
    setMobileNavOpen(false);
    setReconcileVisible(false);
  }, [pathname]);

  // Render-phase sync of the process-wide demo mask (see src/lib/demo-mode.ts).
  // Money formatters are pure and can't subscribe to React state, so AppLayout
  // pushes the effective flag here — DURING render, before returning JSX — so
  // the first paint after a toggle already formats correctly; an effect would
  // be one paint late. The write is idempotent, hence safe under StrictMode /
  // concurrent re-renders.
  const demoMasked = demoMode;
  if (typeof window !== 'undefined') setDemoMask(demoMasked);

  // Keyboard shortcuts — declared after openDrawer/selectedYearMonth
  const commandPalette = useCommandPalette({
    onReconcile: handleOpenReconcile,
    onAddIncome: useCallback(
      () =>
        openDrawer({
          mode: 'create',
          entityType: 'income',
          yearMonth: selectedYearMonth,
        }),
      [openDrawer, selectedYearMonth],
    ),
    onAddExpense: useCallback(
      () =>
        openDrawer({
          mode: 'create',
          entityType: 'expense',
          yearMonth: selectedYearMonth,
        }),
      [openDrawer, selectedYearMonth],
    ),
  });

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((previous) => !previous);
  }, [setSidebarCollapsed]);

  // Display mode
  const [displayMode, setDisplayModeState] = useState<DisplayMode>('advanced');
  const setDisplayMode = useCallback(async (mode: DisplayMode) => {
    setDisplayModeState(mode);
    const { updateDisplayMode } =
      await import('@/lib/actions/user-preferences');
    await updateDisplayMode(mode);
  }, []);

  // Custom mobile bottom-nav tabs (null ⇒ per-display-mode defaults).
  const [bottomNavIds, setBottomNavIds] = useState<string[] | null>(null);

  // Onboarding wizard state
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Lazy wizards mount on first open and stay mounted afterwards (derived
  // during render — React's "adjust state on prop change" pattern).
  const [reconcileMounted, setReconcileMounted] = useState(false);
  if (reconcileVisible && !reconcileMounted) setReconcileMounted(true);
  const [onboardingMounted, setOnboardingMounted] = useState(false);
  if (showOnboarding && !onboardingMounted) setOnboardingMounted(true);

  useEffect(() => {
    getUserPreferences().then((result) => {
      if (result.success && result.data) {
        if (!result.data.hasCompletedOnboarding) {
          setShowOnboarding(true);
        }
        if (result.data.bottomNavIds) {
          setBottomNavIds(result.data.bottomNavIds);
        }
        if (result.data.displayMode) {
          setDisplayModeState(result.data.displayMode);
        } else if (!result.data.hasCompletedOnboarding) {
          // New users start in Simple mode (onboarding lets them pick and
          // persists the choice); accounts that predate the mode keep Advanced.
          setDisplayModeState('simple');
        }
      }
    });
  }, []);

  // Fetch accounts. Stable identity (no selectedAccountId dep): the default
  // selection uses a functional update, so picking the first account no
  // longer re-creates this callback and re-runs the mount effect (which
  // used to call getAccounts twice on every page load).
  const fetchAccounts = useCallback(async () => {
    try {
      const result = await getAccounts();
      if (result.success && result.data) {
        const activeAccounts = result.data.filter(
          (a: FinancialAccount) => !a.isArchived,
        );
        // `accountsLoaded` flips in the SAME transition as the list, so
        // no consumer ever sees "loaded" with a still-empty list.
        startTransition(() => {
          setAccounts(result.data!);
          setAccountsLoaded(true);
          if (activeAccounts.length > 0) {
            // Keep the current pick unless it was archived or deleted.
            setSelectedAccountId((prev) =>
              prev && activeAccounts.some((a) => a.id === prev)
                ? prev
                : activeAccounts[0].id,
            );
          }
        });
        return;
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
    setAccountsLoaded(true);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);
  // The accounts list is shared state too: refetch it on every data change.
  useDataRefresh(fetchAccounts);

  const handleDataChange = useCallback(() => notifyDataChanged(), []);

  const handleAddItem = (type: 'income' | 'expense', yearMonth?: string) => {
    openDrawer({
      mode: 'create',
      entityType: type === 'income' ? 'income' : 'expense',
      yearMonth: yearMonth || selectedYearMonth,
    });
  };

  const openSplitQuickAdd = useCallback(
    () => openDrawer({ mode: 'create', entityType: 'split-expense' }),
    [openDrawer],
  );

  // Pages read `appContext` in effect deps — an un-memoized object literal
  // here is a new reference every AppLayout render, re-running those effects
  // (and their fetches) in a loop that flickered the page's loading skeleton.
  // Memoize with every value referenced in the object listed as a dep.
  const contextValue: AppContextValue = useMemo(
    () => ({
      refreshData: handleDataChange,
      selectedAccountId,
      setSelectedAccountId,
      accounts,
      accountsLoaded,
      drawerState,
      openDrawer,
      closeDrawer,
      openReconcile: handleOpenReconcile,
      selectedYearMonth,
      setSelectedYearMonth,
      sidebarCollapsed,
      setSidebarCollapsed,
      displayMode,
      setDisplayMode,
      bottomNavIds,
      setBottomNavIds,
      demoMode,
      demoMasked,
      setDemoMode,
    }),
    [
      handleDataChange,
      selectedAccountId,
      setSelectedAccountId,
      accounts,
      accountsLoaded,
      drawerState,
      openDrawer,
      closeDrawer,
      handleOpenReconcile,
      selectedYearMonth,
      setSelectedYearMonth,
      sidebarCollapsed,
      setSidebarCollapsed,
      displayMode,
      setDisplayMode,
      bottomNavIds,
      setBottomNavIds,
      demoMode,
      demoMasked,
      setDemoMode,
    ],
  );

  return (
    <AppContext.Provider value={contextValue}>
      <ToastProvider>
        <CelebrationProvider>
          {/* One app-wide queued confirmation host. */}
          <ConfirmDialog />
          {/* Opt-in local check-in notification (renders nothing). */}
          <CheckinNotifier />
          <div className="min-h-screen bg-transparent">
            {/* Desktop (lg+) sidebar */}
            <SidebarNav
              onOpenCommandPalette={commandPalette.open}
              collapsed={sidebarCollapsed}
              onToggleCollapse={handleToggleSidebar}
            />

            {/* Mobile (< lg) chrome */}
            <MobileTopBar
              onOpenMenu={() => setMobileNavOpen(true)}
              onOpenCommandPalette={commandPalette.open}
              onOpenSplitQuickAdd={openSplitQuickAdd}
              demoMode={demoMode}
              onExitDemo={() => setDemoMode(false)}
            />
            <BottomNav onOpenMore={() => setMobileNavOpen(true)} />
            <MobileNavDrawer
              visible={mobileNavOpen}
              onHide={() => setMobileNavOpen(false)}
            />

            {/* Desktop-breakpoint installed PWA (e.g. iPad): the app runs
                        edge-to-edge under the OS status bar (viewport-fit=cover),
                        and the desktop layout has no mobile top bar to clear it.
                        Paint a glass strip under the status bar so scrolled
                        content never shows through the clock/battery area.
                        env() is 0 in a normal desktop browser — zero height. */}
            <div className="hidden lg:block fixed top-0 inset-x-0 h-[env(safe-area-inset-top)] z-40 glass-chrome" />

            {/* Demo-mode indicator pill (lg+) — shown on ALL pages while demo
                        mode is on. Tap to turn it off. Below lg the pill lives inside
                        MobileTopBar (in flow, never over the Search button).
                        z-45: above the chrome (z-40), below overlays (z-50). */}
            {demoMode && (
              <button
                type="button"
                onClick={() => setDemoMode(false)}
                title="Demo mode — amounts hidden. Tap to show them again."
                aria-label="Demo mode active — tap to show amounts"
                className="hidden lg:flex min-h-11 fixed z-[45] right-3 top-[calc(0.75rem+env(safe-area-inset-top))] rounded-full border surface-border bg-[var(--surface-card)]/80 backdrop-blur px-3 py-1.5 text-xs items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <MdVisibilityOff size={14} />
                <span>Demo</span>
              </button>
            )}

            <main
              className={`transition-[margin-left] duration-(--motion-slow) ease-fluid motion-reduce:transition-none pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pt-[env(safe-area-inset-top)] lg:pb-[env(safe-area-inset-bottom)] ${sidebarCollapsed ? 'lg:ml-22' : 'lg:ml-68'}`}
            >
              <div className="relative px-2 sm:px-4 lg:px-6">
                <div
                  className={preferencesReady ? undefined : 'invisible'}
                  inert={!preferencesReady}
                  aria-hidden={!preferencesReady || undefined}
                >
                  {children}
                </div>
                {!preferencesReady && (
                  <div
                    role="status"
                    aria-label="Loading your preferences"
                    className="absolute inset-x-2 top-0 space-y-4 py-8 sm:inset-x-4 lg:inset-x-6"
                  >
                    <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
                    <div className="h-36 animate-pulse rounded-2xl bg-muted" />
                  </div>
                )}
              </div>
            </main>

            {/* Command Palette */}
            <CommandPalette
              isOpen={commandPalette.isOpen}
              onClose={commandPalette.close}
              onNavigate={(path) => router.push(path)}
              onAddItem={handleAddItem}
              onReconcile={() => setReconcileVisible(true)}
              onAddSplitExpense={openSplitQuickAdd}
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

            {/* Reconcile Wizard — lazy; mounted from its first open on so
                        the dialog keeps its close animation (it resets on open). */}
            {reconcileMounted && (
              <ReconcileWizard
                visible={reconcileVisible}
                onHide={() => setReconcileVisible(false)}
                onComplete={handleDataChange}
              />
            )}

            {/* Onboarding Wizard — lazy; only ever mounted for users who
                        haven't completed onboarding. */}
            {onboardingMounted && (
              <OnboardingWizard
                visible={showOnboarding}
                onComplete={() => {
                  setShowOnboarding(false);
                  handleDataChange();
                }}
              />
            )}

            {/* Desktop quick-add stays in the corner; mobile uses the top toolbar
                so this action never covers money in scrolling data rows. */}
            <button
              type="button"
              onClick={openSplitQuickAdd}
              aria-label="Add shared expense"
              className="fixed right-6 bottom-6 z-40 hidden lg:flex items-center justify-center w-14 h-14 rounded-full bg-accent-700 hover:bg-accent-800 border border-white/25 dark:border-white/15 text-white shadow-lg transition-colors"
            >
              <MdAdd size={28} />
            </button>
          </div>
        </CelebrationProvider>
      </ToastProvider>
    </AppContext.Provider>
  );
}
