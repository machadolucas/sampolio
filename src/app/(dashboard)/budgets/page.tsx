'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'primereact/button';
import { ProgressSpinner } from 'primereact/progressspinner';
import { MdAdd, MdLuggage } from 'react-icons/md';
import { useAppContext } from '@/components/layout/app-layout';
import { getBudgets } from '@/lib/actions/budgets';
import { BudgetCard } from '@/components/budgets/budget-card';
import { BudgetSetupWizard } from '@/components/budgets/budget-setup-wizard';
import type { Budget } from '@/types';

export default function BudgetsPage() {
  const router = useRouter();
  const appContext = useAppContext();

  const [isLoading, setIsLoading] = useState(true);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const hasLoadedOnce = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    try {
      const res = await getBudgets();
      if (res.success && res.data) setBudgets(res.data);
    } catch (err) {
      console.error('Failed to load budgets:', err);
    } finally {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (appContext) appContext.setRefreshCallback(fetchData); }, [appContext, fetchData]);

  const active = budgets.filter(b => !b.isArchived);
  const archived = budgets.filter(b => b.isArchived);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <ProgressSpinner />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budgets</h1>
          <p className="text-sm opacity-60">Plan trips and projects, and track grant money.</p>
        </div>
        <Button label="Plan a new budget" icon={<MdAdd />} onClick={() => setWizardOpen(true)} />
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MdLuggage size={48} className="opacity-30 mb-4" />
          <p className="text-lg font-medium mb-1">Plan a trip or a project</p>
          <p className="text-sm opacity-60 max-w-md mb-4">
            Add what it&apos;ll cost and who&apos;s paying — grants, daily allowances, your own money — and Sampolio
            tells you if it adds up. When it&apos;s a go, one click puts it in your cashflow.
          </p>
          <Button label="Plan a new budget" icon={<MdAdd />} onClick={() => setWizardOpen(true)} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.map(b => (
              <BudgetCard key={b.id} budget={b} onClick={() => router.push(`/budgets/${b.id}`)} />
            ))}
          </div>
          {archived.length > 0 && (
            <div className="pt-2">
              <Button
                label={showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
                text
                size="small"
                severity="secondary"
                onClick={() => setShowArchived(s => !s)}
              />
              {showArchived && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  {archived.map(b => (
                    <BudgetCard key={b.id} budget={b} onClick={() => router.push(`/budgets/${b.id}`)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <BudgetSetupWizard
        visible={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(b) => {
          setWizardOpen(false);
          router.push(`/budgets/${b.id}`);
        }}
      />
    </div>
  );
}
