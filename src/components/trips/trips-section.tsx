'use client';

import { MaterialToolbar } from '@/components/ui/page-header';

import { Trash2 } from 'lucide-react';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { MdAdd, MdFlightTakeoff } from 'react-icons/md';
import { useToast } from '@/components/providers/toast-provider';
import { updateTrip, deleteTrip } from '@/lib/actions/trips';
import { TripCard } from '@/components/trips/trip-card';
import { TripDialog } from '@/components/trips/trip-dialog';
import { notifyDataChanged } from '@/lib/hooks/use-data-refresh';
import type { Budget, FinancialAccount, Trip, TripStatus } from '@/types';

interface TripsSectionProps {
  trips: Trip[];
  accounts: FinancialAccount[];
  /** All of the user's budgets — used to label trips that fund a budget. */
  budgets: Budget[];
  /** Re-fetch the parent page's data after a create/update/delete. */
  onChanged: () => void;
}

/**
 * The Trips half of the merged "Trips & Budgets" page: per-diem calculator
 * cards, status transitions, and the create/edit dialog. Trips/accounts are
 * fetched by the parent; status/delete announce via `notifyDataChanged` (the
 * parent refetches through `useDataRefresh`), the dialog's save also calls `onChanged`.
 */
export function TripsSection({ trips, accounts, budgets, onChanged }: TripsSectionProps) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [showReimbursed, setShowReimbursed] = useState(false);

  const accountName = (id: string): string | undefined => accounts.find((a) => a.id === id)?.name;

  // tripId → name of the budget its per diem funds (any budget, any status).
  const tripToBudgetName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of budgets) {
      for (const s of b.fundingSources) if (s.linkedTripId) map[s.linkedTripId] = b.name;
    }
    return map;
  }, [budgets]);

  const openCreate = () => { setEditingTrip(null); setDialogOpen(true); };
  const openEdit = (trip: Trip) => { setEditingTrip(trip); setDialogOpen(true); };

  const handleAdvanceStatus = async (trip: Trip, nextStatus: TripStatus) => {
    const res = await updateTrip(trip.id, { status: nextStatus });
    if (res.success) {
      toast.success(
        nextStatus === 'reimbursed' ? 'Trip marked reimbursed' : 'Trip marked completed',
        trip.name
      );
      notifyDataChanged();
    } else {
      toast.error('Error', res.error || 'Failed to update trip');
    }
  };

  const handleDelete = (trip: Trip) => {
    const fundsBudget = tripToBudgetName[trip.id];
    confirmDialog({
      message: fundsBudget
        ? `Delete "${trip.name}"? This trip funds “${fundsBudget}” — that budget will keep the trip's last computed amount. This cannot be undone.`
        : `Delete "${trip.name}"? This cannot be undone.`,
      header: 'Delete trip',
      icon: <Trash2 size={16} />,
      severity: 'danger',
      accept: async () => {
        const res = await deleteTrip(trip.id);
        if (res.success) {
          toast.success('Trip deleted', trip.name);
          notifyDataChanged();
        } else {
          toast.error('Error', res.error || 'Failed to delete trip');
        }
      },
    });
  };

  const active = trips.filter((t) => t.status !== 'reimbursed');
  const reimbursed = trips.filter((t) => t.status === 'reimbursed');

  const renderGrid = (list: Trip[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {list.map((t) => (
        <TripCard
          key={t.id}
          trip={t}
          linkedAccountName={accountName(t.linkedAccountId)}
          fundedByBudgetName={tripToBudgetName[t.id]}
          onEdit={() => openEdit(t)}
          onDelete={() => handleDelete(t)}
          onAdvanceStatus={(nextStatus) => handleAdvanceStatus(t, nextStatus)}
        />
      ))}
    </div>
  );

  return (
    <section id="trips" className="space-y-4">
      <MaterialToolbar aria-label="Trips controls" className="justify-between">
        <div>
          <h2 className="text-xl font-semibold">Trips</h2>
          <p className="text-sm text-muted-foreground">
            Calculate tax-free per-diem allowances for work travel (Finnish Vero.fi rules) and track their reimbursement.
          </p>
        </div>
        <Button label="New trip" icon={<MdAdd />} className="shrink-0 self-start sm:self-auto" onClick={openCreate} />
      </MaterialToolbar>

      {trips.length === 0 ? (
        <EmptyState className="rounded-2xl border border-border bg-card"
          icon={<MdFlightTakeoff />}
          title="Plan your first trip"
          body="Enter the departure and return date/time and Sampolio works out the tax-free per-diem for you, using the official Vero.fi rates."
          action={{ label: 'New trip', icon: <MdAdd />, onClick: openCreate }}
        />
      ) : (
        <>
          {active.length > 0 ? renderGrid(active) : (
            <p className="text-sm text-muted-foreground py-4">No active trips — every trip has been reimbursed.</p>
          )}
          {reimbursed.length > 0 && (
            <div className="pt-2">
              <Button
                label={showReimbursed ? 'Hide reimbursed' : `Show reimbursed (${reimbursed.length})`}
                text
                size="small"
                severity="secondary"
                onClick={() => setShowReimbursed((s) => !s)}
              />
              {showReimbursed && <div className="animate-fade-in mt-2">{renderGrid(reimbursed)}</div>}
            </div>
          )}
        </>
      )}

      <TripDialog
        visible={dialogOpen}
        trip={editingTrip}
        accounts={accounts}
        onHide={() => setDialogOpen(false)}
        onSaved={onChanged}
      />
    </section>
  );
}
