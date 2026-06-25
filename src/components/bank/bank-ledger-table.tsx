'use client';

import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { formatCurrency } from '@/lib/constants';
import type { BankTransaction, Currency } from '@/types';

/** Read-only transaction ledger for one linked bank account. Mirrors the
 * mortgage ledger: a scrollable PrimeReact DataTable, newest first, with
 * colored signed amounts and a booked/pending status tag. */
export function BankLedgerTable({
  transactions,
  currency,
}: {
  transactions: BankTransaction[];
  currency: Currency;
}) {
  if (transactions.length === 0) {
    return <p className="text-sm opacity-60">No transactions cached yet — try Refresh now in Settings.</p>;
  }

  const dateBody = (t: BankTransaction) => {
    const d = new Date(`${t.bookingDate}T00:00:00`);
    return <span className="whitespace-nowrap">{d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>;
  };

  const counterpartyBody = (t: BankTransaction) => (
    <div className="min-w-[10rem]">
      <div className="font-medium text-sm">{t.counterpartyName ?? '—'}</div>
      {t.remittanceInfo && <div className="text-xs opacity-60 truncate max-w-[20rem]">{t.remittanceInfo}</div>}
    </div>
  );

  const amountBody = (t: BankTransaction) => (
    <span className={t.amount < 0 ? 'text-red-500 font-medium' : 'text-green-600 font-medium'}>
      {formatCurrency(t.amount, currency)}
    </span>
  );

  const statusBody = (t: BankTransaction) => (
    <Tag
      value={t.status}
      severity={t.status === 'booked' ? 'success' : t.status === 'pending' ? 'warning' : 'info'}
    />
  );

  return (
    <DataTable
      value={transactions}
      scrollable
      scrollHeight="420px"
      size="small"
      stripedRows
      dataKey="id"
      paginator
      rows={25}
      rowsPerPageOptions={[25, 50, 100]}
    >
      <Column header="Date" body={dateBody} style={{ width: '8rem' }} />
      <Column header="Counterparty / details" body={counterpartyBody} />
      <Column header="Amount" body={amountBody} style={{ width: '9rem' }} align="right" />
      <Column header="Status" body={statusBody} style={{ width: '7rem' }} />
    </DataTable>
  );
}
