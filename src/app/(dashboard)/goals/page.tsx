'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from '@/lib/auth-client';
import { Button } from 'primereact/button';
import { confirmDialog } from 'primereact/confirmdialog';
import { ListPageSkeleton } from '@/components/ui/skeletons';
import { MdAdd, MdErrorOutline, MdFlag } from 'react-icons/md';
import { useAppContext } from '@/components/layout/app-layout';
import { useToast } from '@/components/providers/toast-provider';
import { updateGoal, deleteGoal } from '@/lib/actions/goals';
import { getGoalsPageData } from '@/lib/actions/dashboard-data';
import { calculateGoalProgress, computeGoalPlan } from '@/lib/goal-utils';
import { assembleWealthProjection } from '@/lib/wealth-assembly';
import { AlertBanner } from '@/components/ui/alert-banner';
import { GoalCard } from '@/components/goals/goal-card';
import { GoalDialog } from '@/components/goals/goal-dialog';
import type { FinancialAccount, Goal, MonthlyProjection, WealthProjectionMonth } from '@/types';

export default function GoalsPage() {
  const appContext = useAppContext();
  const toast = useToast();
  const { data: session } = useSession();

  const [isLoading, setIsLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [cashProjections, setCashProjections] = useState<Map<string, MonthlyProjection[]>>(new Map());
  const [wealthMonths, setWealthMonths] = useState<WealthProjectionMonth[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const hasLoadedOnce = useRef(false);
  // True once any load succeeded — a failed FIRST load must not render the
  // "Set your first goal" empty state as if the user had no goals.
  const [hasLoadedData, setHasLoadedData] = useState(false);

  const userId = session?.user?.id;

  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    try {
      // One aggregate read: goals + accounts + (when any goal needs them) the
      // wealth inputs, whose per-account projections also serve the
      // account-balance goals — each projection is computed exactly once.
      const res = await getGoalsPageData();
      if (!res.success || !res.data) {
        // Keep whatever loaded last; never fall back to an empty "no goals" state.
        setLoadError(res.error || "Couldn't load your goals. Try again.");
        return;
      }
      const { goals: loadedGoals, accounts: loadedAccounts, wealth } = res.data;
      setGoals(loadedGoals);
      setAccounts(loadedAccounts);

      // Projections only for the accounts goals actually track.
      const linkedAccountIds = new Set(
        loadedGoals
          .filter((g) => !g.isArchived && g.trackingMethod === 'account-balance' && g.linkedAccountId)
          .map((g) => g.linkedAccountId as string)
      );
      setCashProjections(new Map(
        [...linkedAccountIds].map((id) => [id, wealth?.cashProjections[id]?.monthly ?? []] as [string, MonthlyProjection[]])
      ));

      // The full wealth projection is needed for net-worth goals directly, AND
      // for the joint plan whenever ANY non-manual goal exists — an
      // account-balance goal's claim also reduces the net-worth pool for
      // later net-worth goals (see computeGoalPlan in goal-utils.ts). The
      // action returns `wealth` exactly in that case.
      if (wealth) {
        const now = new Date();
        const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        setWealthMonths(assembleWealthProjection(wealth, userId, startDate, 60, now).months);
      } else {
        setWealthMonths([]);
      }
      setLoadError(null);
      setHasLoadedData(true);
    } catch (err) {
      console.error('Failed to load goals:', err);
      setLoadError("Couldn't load your goals. Check your connection and try again.");
    } finally {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (appContext) appContext.setRefreshCallback(fetchData); }, [appContext, fetchData]);

  const warningFor = (goal: Goal): string | undefined => {
    if (goal.trackingMethod === 'account-balance' && goal.linkedAccountId && !accounts.some((a) => a.id === goal.linkedAccountId)) {
      return 'The linked account no longer exists — edit the goal to pick another.';
    }
    return undefined;
  };

  // Active goals share pools (an account's balance, or net worth) — plan them
  // jointly so cards reflect what's actually left for each goal once earlier
  // (higher-priority / earlier-dated) goals have claimed their share.
  const activeGoals = goals.filter((g) => !g.isArchived);
  const goalPlan = useMemo(
    () => computeGoalPlan(activeGoals, cashProjections, wealthMonths),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeGoals.map((g) => g.id).join(','), activeGoals.map((g) => g.updatedAt).join(','), cashProjections, wealthMonths]
  );

  const openCreate = () => { setEditingGoal(null); setDialogOpen(true); };
  const openEdit = (goal: Goal) => { setEditingGoal(goal); setDialogOpen(true); };

  const handleToggleArchive = async (goal: Goal) => {
    const res = await updateGoal(goal.id, { isArchived: !goal.isArchived });
    if (res.success) {
      toast.success(goal.isArchived ? 'Goal unarchived' : 'Goal archived', goal.name);
      fetchData();
    } else {
      toast.error('Error', res.error || 'Failed to update goal');
    }
  };

  const handleDelete = (goal: Goal) => {
    confirmDialog({
      message: `Delete "${goal.name}"? This cannot be undone.`,
      header: 'Delete goal',
      icon: 'pi pi-trash',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        const res = await deleteGoal(goal.id);
        if (res.success) {
          toast.success('Goal deleted', goal.name);
          fetchData();
        } else {
          toast.error('Error', res.error || 'Failed to delete goal');
        }
      },
    });
  };

  const active = activeGoals;
  const archived = goals.filter((g) => g.isArchived);

  if (isLoading) {
    return <ListPageSkeleton />;
  }

  // Active goals render in plan order (priority, then target date, then name)
  // with the joint-plan context; archived goals keep the standalone
  // calculateGoalProgress path (no pool claims — they're no longer competing).
  const renderActiveGrid = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {goalPlan.entries.map(({ goal: g, progress, competingGoalIds, requiredMonthlySaving, targetDatePassed }) => (
        <GoalCard
          key={g.id}
          goal={g}
          progress={progress}
          warning={warningFor(g)}
          plan={{ competingGoalIds, requiredMonthlySaving, targetDatePassed }}
          onEdit={() => openEdit(g)}
          onToggleArchive={() => handleToggleArchive(g)}
          onDelete={() => handleDelete(g)}
        />
      ))}
    </div>
  );

  const renderArchivedGrid = (list: Goal[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {list.map((g) => {
        const progress = calculateGoalProgress(g, cashProjections, wealthMonths);
        return (
          <GoalCard
            key={g.id}
            goal={g}
            progress={progress}
            warning={warningFor(g)}
            onEdit={() => openEdit(g)}
            onToggleArchive={() => handleToggleArchive(g)}
            onDelete={() => handleDelete(g)}
          />
        );
      })}
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm opacity-60">Set savings targets and see when your plan reaches them.</p>
        </div>
        <Button label="New goal" icon={<MdAdd />} className="shrink-0 self-start sm:self-auto" onClick={openCreate} />
      </div>

      {loadError && (
        <AlertBanner severity="error" icon={<MdErrorOutline />} action={{ label: 'Retry', onClick: () => { void fetchData(); } }}>
          {loadError}
        </AlertBanner>
      )}

      {loadError && !hasLoadedData ? null : active.length === 0 && archived.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MdFlag size={48} className="opacity-30 mb-4" />
          <p className="text-lg font-medium mb-1">Set your first goal</p>
          <p className="text-sm opacity-60 max-w-md mb-4">
            A target amount and a date — Sampolio tracks it against an account&apos;s projected balance,
            your total net worth, or a number you update yourself.
          </p>
          <Button label="New goal" icon={<MdAdd />} onClick={openCreate} />
        </div>
      ) : (
        <>
          {renderActiveGrid()}
          {archived.length > 0 && (
            <div className="pt-2">
              <Button
                label={showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
                text
                size="small"
                severity="secondary"
                onClick={() => setShowArchived((s) => !s)}
              />
              {showArchived && <div className="animate-fade-in mt-2">{renderArchivedGrid(archived)}</div>}
            </div>
          )}
        </>
      )}

      <GoalDialog
        visible={dialogOpen}
        goal={editingGoal}
        accounts={accounts}
        onHide={() => setDialogOpen(false)}
        onSaved={fetchData}
      />
    </div>
  );
}
