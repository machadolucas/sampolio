'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { Tag } from 'primereact/tag';
import { Message } from 'primereact/message';
import { Dialog } from 'primereact/dialog';
import { Toast } from 'primereact/toast';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import { ProgressSpinner } from 'primereact/progressspinner';
import { InputSwitch } from 'primereact/inputswitch';
import { MdAccountBalance, MdAdd, MdSync, MdLinkOff } from 'react-icons/md';
import { useTheme } from '@/components/providers/theme-provider';
import {
  getBankFeatureStatus,
  getBankConnections,
  listBankAspsps,
  startBankConnection,
  refreshBankConnection,
  disconnectBankConnection,
  updateBankAccountLink,
} from '@/lib/actions/bank';
import { getAccounts } from '@/lib/actions/accounts';
import { maskIban, getConsentExpiryInfo } from '@/lib/bank-utils';
import type {
  BankConnection,
  BankAccountLink,
  BankAccountRole,
  BankConnectionStatus,
  FinancialAccount,
} from '@/types';

const ROLE_OPTIONS: { label: string; value: BankAccountRole }[] = [
  { label: 'Cash account', value: 'cash' },
  { label: 'Savings', value: 'savings' },
  { label: 'Credit card', value: 'credit-card' },
  { label: 'Other', value: 'other' },
];

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

export function BankConnectionsPanel() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const toastRef = useRef<Toast>(null);
  const hasLoadedOnce = useRef(false);

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Connect dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aspsps, setAspsps] = useState<{ label: string; value: string; country: string }[]>([]);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const toast = (msg: string, severity: 'success' | 'error' | 'info' = 'success') =>
    toastRef.current?.show({
      severity,
      summary: severity === 'error' ? 'Error' : severity === 'info' ? 'Info' : 'Done',
      detail: msg,
      life: 4000,
    });

  const load = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const status = await getBankFeatureStatus();
      const isConfigured = status.success && !!status.data?.configured;
      setConfigured(isConfigured);
      if (isConfigured) {
        const [connRes, acctRes] = await Promise.all([getBankConnections(), getAccounts()]);
        if (connRes.success && connRes.data) setConnections(connRes.data);
        if (acctRes.success && acctRes.data) setAccounts(acctRes.data.filter((a) => !a.isArchived));
      }
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Surface the result of a returning consent (?bankConnected / ?bankError).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('bankConnected');
    const error = params.get('bankError');
    if (connected) toast(`Connected ${decodeURIComponent(connected)} — syncing your accounts`);
    else if (error) toast(`Bank connection failed (${error})`, 'error');
    if (connected || error) {
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  const openConnectDialog = async () => {
    setDialogOpen(true);
    setSelectedBank(null);
    const res = await listBankAspsps('FI');
    if (res.success && res.data) {
      setAspsps(res.data.map((a) => ({ label: a.name, value: a.name, country: a.country })));
    } else {
      toast(res.error ?? 'Could not load banks', 'error');
    }
  };

  const handleConnect = async () => {
    if (!selectedBank) return;
    setConnecting(true);
    const country = aspsps.find((a) => a.value === selectedBank)?.country ?? 'FI';
    const res = await startBankConnection({ aspspName: selectedBank, aspspCountry: country });
    setConnecting(false);
    if (res.success && res.data?.authUrl) {
      window.location.href = res.data.authUrl; // off to the bank for SCA
    } else {
      toast(res.error ?? 'Could not start the connection', 'error');
    }
  };

  const handleRefresh = async (connectionId: string) => {
    setBusyId(connectionId);
    const res = await refreshBankConnection(connectionId);
    setBusyId(null);
    if (res.success) {
      toast('Refreshed');
      load();
    } else {
      toast(res.error ?? 'Refresh failed', 'error');
    }
  };

  const handleDisconnect = (conn: BankConnection) =>
    confirmDialog({
      message: `Disconnect ${conn.aspspName}? This removes the cached balances and transactions and revokes the bank consent. Your manually-entered data is untouched.`,
      header: 'Disconnect bank',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        setBusyId(conn.id);
        const res = await disconnectBankConnection(conn.id);
        setBusyId(null);
        if (res.success) {
          toast('Disconnected');
          load();
        } else {
          toast(res.error ?? 'Disconnect failed', 'error');
        }
      },
    });

  const patchLink = async (
    connectionId: string,
    linkId: string,
    data: Parameters<typeof updateBankAccountLink>[2]
  ) => {
    const res = await updateBankAccountLink(connectionId, linkId, data);
    if (res.success && res.data) {
      setConnections((prev) => prev.map((c) => (c.id === connectionId ? res.data! : c)));
    } else {
      toast(res.error ?? 'Update failed', 'error');
    }
  };

  const heading = `text-lg font-semibold mb-1 ${isDark ? 'text-gray-100' : 'text-gray-900'}`;
  const subtle = `text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`;

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <ProgressSpinner style={{ width: 24, height: 24 }} strokeWidth="6" />
          <span className={subtle}>Loading bank connections…</span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Toast ref={toastRef} />
      <ConfirmDialog />

      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className={heading}>Bank connections</h2>
          <p className={subtle}>
            Read-only PSD2 (AIS) sync via Enable Banking. Balances auto-anchor your forecasts; the
            app only ever reads the local encrypted cache. IBANs are masked and never logged.
          </p>
        </div>
        {configured && (
          <Button label="Connect a bank" icon={<MdAdd />} size="small" onClick={openConnectDialog} />
        )}
      </div>

      {!configured && (
        <Message
          severity="info"
          className="w-full"
          text="Bank sync is not configured on this server. Add the Enable Banking secrets (app id, redirect URL, private key) to enable it."
        />
      )}

      {configured && connections.length === 0 && (
        <div className={`flex flex-col items-center text-center gap-2 py-6 ${subtle}`}>
          <MdAccountBalance size={32} className="opacity-50" />
          <p>No banks connected yet. Connect one to pull balances and transactions automatically.</p>
        </div>
      )}

      <div className="space-y-4">
        {connections.map((conn) => {
          const expiry = getConsentExpiryInfo(conn);
          return (
            <div
              key={conn.id}
              className={`rounded-lg border p-4 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
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
                <div className="flex items-center gap-2">
                  <Button
                    label="Refresh now"
                    icon={<MdSync />}
                    size="small"
                    outlined
                    loading={busyId === conn.id}
                    onClick={() => handleRefresh(conn.id)}
                  />
                  <Button
                    icon={<MdLinkOff />}
                    size="small"
                    severity="danger"
                    text
                    tooltip="Disconnect"
                    onClick={() => handleDisconnect(conn)}
                  />
                </div>
              </div>

              <p className={`${subtle} mb-3`}>
                {conn.lastSyncAt
                  ? `Last synced ${new Date(conn.lastSyncAt).toLocaleString('en-GB')} · ${conn.lastSyncStatus ?? ''}`
                  : 'Not synced yet'}
                {expiry.expiresAt && ` · consent valid until ${expiry.expiresAt.toLocaleDateString('en-GB')}`}
              </p>

              {conn.linkedAccounts.length === 0 && (
                <p className={subtle}>No accounts returned yet — try Refresh now.</p>
              )}

              <div className="space-y-3">
                {conn.linkedAccounts.map((link) => (
                  <AccountLinkRow
                    key={link.id}
                    link={link}
                    accounts={accounts}
                    isDark={isDark}
                    onPatch={(data) => patchLink(conn.id, link.id, data)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        header="Connect a bank"
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        style={{ width: '28rem' }}
      >
        <div className="space-y-4">
          <p className={subtle}>
            Pick your bank. You&apos;ll be sent to the bank to approve read-only access (strong
            authentication is required by law). Only whitelisted IBANs return data.
          </p>
          <Dropdown
            value={selectedBank}
            options={aspsps}
            onChange={(e) => setSelectedBank(e.value)}
            placeholder={aspsps.length ? 'Select your bank' : 'Loading banks…'}
            filter
            className="w-full"
          />
          <div className="flex justify-end gap-2">
            <Button label="Cancel" text onClick={() => setDialogOpen(false)} />
            <Button
              label="Continue to bank"
              disabled={!selectedBank}
              loading={connecting}
              onClick={handleConnect}
            />
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

function AccountLinkRow({
  link,
  accounts,
  isDark,
  onPatch,
}: {
  link: BankAccountLink;
  accounts: FinancialAccount[];
  isDark: boolean;
  onPatch: (data: Parameters<typeof updateBankAccountLink>[2]) => void;
}) {
  const subtle = `text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`;
  const accountOptions = [
    { label: '— not linked —', value: null as string | null },
    ...accounts.map((a) => ({ label: a.name, value: a.id })),
  ];
  const isCard = link.accountRole === 'credit-card';

  return (
    <div className={`rounded-md p-3 ${isDark ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[10rem]">
          <div className="font-medium text-sm">{link.name ?? 'Account'}</div>
          <div className={subtle}>
            {maskIban(link.iban)} · {link.currency}
            {typeof link.lastBalance === 'number' && (
              <> · {link.lastBalance.toLocaleString('fi-FI', { minimumFractionDigits: 2 })}</>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={subtle}>Type</label>
          <Dropdown
            value={link.accountRole}
            options={ROLE_OPTIONS}
            onChange={(e) => onPatch({ accountRole: e.value })}
            className="w-40"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={subtle}>{isCard ? 'Paid from account' : 'Anchors account'}</label>
          <Dropdown
            value={link.linkedFinancialAccountId ?? null}
            options={accountOptions}
            onChange={(e) => onPatch({ linkedFinancialAccountId: e.value })}
            className="w-48"
            placeholder="Choose account"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={subtle}>Exclude</label>
          <InputSwitch
            checked={!!link.isExcluded}
            onChange={(e) => onPatch({ isExcluded: e.value })}
          />
        </div>
      </div>

      {isCard && (
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div className="flex flex-col gap-1">
            <label className={subtle}>Statement closes (day)</label>
            <InputNumber
              value={link.statementDay ?? null}
              onValueChange={(e) => onPatch({ statementDay: e.value ?? null })}
              min={1}
              max={31}
              showButtons
              className="w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={subtle}>Payment due (day)</label>
            <InputNumber
              value={link.paymentDueDay ?? null}
              onValueChange={(e) => onPatch({ paymentDueDay: e.value ?? null })}
              min={1}
              max={31}
              showButtons
              className="w-28"
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <span className={subtle}>Estimate open cycle</span>
            <InputSwitch
              checked={!!link.includeOpenCycleEstimate}
              onChange={(e) => onPatch({ includeOpenCycleEstimate: e.value })}
            />
          </div>
        </div>
      )}

      {isCard && link.linkedFinancialAccountId && (
        <Message
          severity="warn"
          className="w-full mt-3"
          text="This card now bills automatically into the paying account. Archive any manual card-expense items you used to enter by hand, to avoid counting them twice (nothing is deleted automatically)."
        />
      )}
    </div>
  );
}
