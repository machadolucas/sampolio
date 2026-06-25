'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { MdAccountBalance, MdCreditCard, MdSavings, MdReceiptLong, MdSettings } from 'react-icons/md';
import { getBankConnections, getBankTransactionsForLink } from '@/lib/actions/bank';
import { maskIban, getConsentExpiryInfo } from '@/lib/bank-utils';
import { formatCurrency } from '@/lib/constants';
import { AllAccountsSummary } from '@/components/bank/all-accounts-summary';
import { BankLedgerTable } from '@/components/bank/bank-ledger-table';
import type { BankConnection, BankAccountLink, BankTransaction, BankConnectionStatus, Currency } from '@/types';

function roleIcon(role: BankAccountLink['accountRole']) {
  if (role === 'credit-card') return <MdCreditCard className="opacity-70" />;
  if (role === 'savings') return <MdSavings className="opacity-70" />;
  return <MdAccountBalance className="opacity-70" />;
}

function statusSeverity(status: BankConnectionStatus): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'active':
      return 'success';
    case 'pending':
      return 'info';
    case 'expired':
    case 'revoked':
      return 'warning';
    case 'error':
      return 'danger';
  }
}

export default function BankPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [openLink, setOpenLink] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<Record<string, BankTransaction[]>>({});
  const [ledgerLoading, setLedgerLoading] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const res = await getBankConnections();
      if (res.success && res.data) setConnections(res.data);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleLedger = async (link: BankAccountLink) => {
    if (openLink === link.id) {
      setOpenLink(null);
      return;
    }
    setOpenLink(link.id);
    if (!ledgers[link.id]) {
      setLedgerLoading(link.id);
      const res = await getBankTransactionsForLink(link.id);
      if (res.success && res.data) setLedgers((prev) => ({ ...prev, [link.id]: res.data! }));
      setLedgerLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <ProgressSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bank</h1>
          <p className="text-sm opacity-60">
            Connected accounts and imported transactions (read-only, via Enable Banking).
          </p>
        </div>
        <Button label="Manage connections" icon={<MdSettings />} outlined size="small" onClick={() => router.push('/settings')} />
      </div>

      <AllAccountsSummary />

      {connections.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center text-center gap-3 py-8 opacity-70">
            <MdAccountBalance size={36} className="opacity-50" />
            <p>No banks connected yet.</p>
            <Button label="Connect a bank" onClick={() => router.push('/settings')} />
          </div>
        </Card>
      ) : (
        connections.map((conn) => {
          const expiry = getConsentExpiryInfo(conn);
          return (
            <Card key={conn.id}>
              <div className="flex items-center gap-2 mb-3">
                <MdAccountBalance className="opacity-70" />
                <span className="font-semibold">{conn.aspspName}</span>
                <Tag value={conn.status} severity={statusSeverity(conn.status)} />
                {(expiry.expired || expiry.expiringSoon) && (
                  <Tag
                    value={expiry.expired ? 'consent expired' : `expires in ${expiry.daysUntilExpiry}d`}
                    severity="warning"
                  />
                )}
              </div>

              <div className="space-y-2">
                {conn.linkedAccounts.length === 0 && (
                  <p className="text-sm opacity-60">No accounts yet — refresh from Settings.</p>
                )}
                {conn.linkedAccounts.map((link) => (
                  <div key={link.id} className="rounded-md border surface-border">
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {roleIcon(link.accountRole)}
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{link.name ?? 'Account'}</div>
                          <div className="text-xs opacity-60">
                            {maskIban(link.iban)} · {link.currency} · {link.accountRole}
                            {typeof link.lastBalance === 'number' && (
                              <> · {formatCurrency(link.lastBalance, link.currency as Currency)}</>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        label={openLink === link.id ? 'Hide' : 'Transactions'}
                        icon={<MdReceiptLong />}
                        text
                        size="small"
                        onClick={() => toggleLedger(link)}
                      />
                    </div>
                    {openLink === link.id && (
                      <div className="p-3 pt-0">
                        {ledgerLoading === link.id ? (
                          <div className="flex items-center gap-2 py-3">
                            <ProgressSpinner style={{ width: 20, height: 20 }} strokeWidth="6" />
                            <span className="text-sm opacity-60">Loading transactions…</span>
                          </div>
                        ) : (
                          <BankLedgerTable
                            transactions={ledgers[link.id] ?? []}
                            currency={link.currency as Currency}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
