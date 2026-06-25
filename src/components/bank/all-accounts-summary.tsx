'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from 'primereact/card';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Tag } from 'primereact/tag';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import {
  getCombinedAccountsProjection,
  type CombinedAccountsProjectionResponse,
  type CombinedAccountsMonth,
} from '@/lib/actions/projection';
import type { Currency } from '@/types';

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Read-only "All accounts" combined cashflow view (a pure aggregation over the
 * existing per-account projections — the forecasting engine is untouched). */
export function AllAccountsSummary() {
  const [data, setData] = useState<CombinedAccountsProjectionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCombinedAccountsProjection().then((r) => {
      if (r.success && r.data) setData(r.data);
      setLoading(false);
    });
  }, []);

  const ym = currentYearMonth();
  const currentRow = useMemo(
    () => data?.months.find((m) => m.yearMonth >= ym) ?? data?.months[0] ?? null,
    [data, ym]
  );
  const upcoming = useMemo(
    () => (data ? data.months.filter((m) => m.yearMonth >= ym).slice(0, 12) : []),
    [data, ym]
  );

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <ProgressSpinner style={{ width: 24, height: 24 }} strokeWidth="6" />
          <span className="text-sm opacity-60">Loading combined view…</span>
        </div>
      </Card>
    );
  }

  if (!data || data.accounts.length === 0) return null;

  const currency = data.currency as Currency;
  const nameById = new Map(data.accounts.map((a) => [a.id, a.name]));

  const monthBody = (m: CombinedAccountsMonth) => formatYearMonth(m.yearMonth);
  const incomeBody = (m: CombinedAccountsMonth) => (
    <span className="text-green-600">{formatCurrency(m.totalIncome, currency)}</span>
  );
  const expenseBody = (m: CombinedAccountsMonth) => (
    <span className="text-red-500">{formatCurrency(m.totalExpenses, currency)}</span>
  );
  const netBody = (m: CombinedAccountsMonth) => (
    <span className={m.netChange < 0 ? 'text-red-500' : 'text-green-600'}>
      {formatCurrency(m.netChange, currency)}
    </span>
  );
  const balanceBody = (m: CombinedAccountsMonth) => (
    <span className="font-medium">{formatCurrency(m.endingBalance, currency)}</span>
  );

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-lg font-semibold mb-1">All accounts</h2>
          <p className="text-sm opacity-60">
            Combined cashflow across every account — a read-only roll-up of your existing forecasts.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs opacity-60">Combined balance now</div>
          <div className="text-2xl font-bold">
            {currentRow ? formatCurrency(currentRow.endingBalance, currency) : '—'}
          </div>
        </div>
      </div>

      {data.mixedCurrencies && (
        <div className="mb-3">
          <Tag severity="warning" value="Mixed currencies — totals are summed without conversion" />
        </div>
      )}

      {currentRow && (
        <div className="flex flex-wrap gap-2 mb-4">
          {currentRow.perAccount.map((p) => (
            <div key={p.accountId} className="rounded-md border px-3 py-1.5 text-sm surface-border">
              <span className="opacity-70">{nameById.get(p.accountId) ?? 'Account'}: </span>
              <span className="font-medium">{formatCurrency(p.endingBalance, currency)}</span>
            </div>
          ))}
        </div>
      )}

      <DataTable value={upcoming} size="small" stripedRows dataKey="yearMonth">
        <Column header="Month" body={monthBody} />
        <Column header="Income" body={incomeBody} align="right" />
        <Column header="Expenses" body={expenseBody} align="right" />
        <Column header="Net" body={netBody} align="right" />
        <Column header="Combined balance" body={balanceBody} align="right" />
      </DataTable>
    </Card>
  );
}
