'use client';

import { ControlGroup } from '@/components/ui/page-header';
/* eslint-disable react-hooks/set-state-in-effect -- the form intentionally prefills its fields when the dialog opens */

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { InputNumber } from '@/components/ui/input-number';
import { Dropdown } from '@/components/ui/dropdown';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Message } from '@/components/ui/message';
import { recordSettleUp } from '@/lib/actions/split-groups';
import { toCents } from '@/lib/split-utils';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useUserProfiles } from '@/lib/hooks/use-user-profiles';
import type { Currency, SplitExpense, SplitGroupMember, SplitMemberBalance } from '@/types';
import { notifyDataChanged } from '@/lib/hooks/use-data-refresh';

export function SettleUpDialog({
  visible,
  onHide,
  groupId,
  members,
  currency,
  myId,
  balances,
  onSaved,
}: {
  visible: boolean;
  onHide: () => void;
  groupId: string;
  members: SplitGroupMember[];
  currency: Currency;
  myId: string;
  balances: SplitMemberBalance[];
  onSaved: (saved?: SplitExpense) => void;
}) {
  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<Date>(new Date());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Prefill the obvious settlement: the debtor pays the creditor the full balance.
  useEffect(() => {
    if (!visible) return;
    const myNet = balances.find((b) => b.userId === myId)?.netCents ?? 0;
    const other = members.find((m) => m.userId !== myId);
    if (myNet < 0 && other) {
      setFromUserId(myId);
      setToUserId(other.userId);
      setAmount(-myNet / 100);
    } else if (myNet > 0 && other) {
      setFromUserId(other.userId);
      setToUserId(myId);
      setAmount(myNet / 100);
    } else {
      setFromUserId(myId);
      setToUserId(other?.userId ?? '');
      setAmount(null);
    }
    setDate(new Date());
    setError('');
  }, [visible, balances, members, myId]);

  const profiles = useUserProfiles(members.map((m) => m.userId));
  const opts = members.map((m) => ({ label: m.userId === myId ? 'You' : m.name, value: m.userId }));
  const memberOption = (opt: { label: string; value: string }) => {
    const member = members.find((m) => m.userId === opt.value);
    return (
      <span className="flex items-center gap-2 min-w-0">
        <UserAvatar userId={opt.value} name={member?.name ?? opt.label} avatarUrl={profiles[opt.value]?.avatarUrl} size={20} />
        <span className="truncate">{opt.label}</span>
      </span>
    );
  };

  const save = async () => {
    if (!amount || amount <= 0) return setError('Enter an amount');
    if (fromUserId === toUserId) return setError('Payer and payee must differ');
    setSaving(true);
    setError('');
    const res = await recordSettleUp(groupId, {
      fromUserId,
      toUserId,
      amountCents: toCents(amount),
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    });
    setSaving(false);
    if (!res.success) return setError(res.error ?? 'Failed to record');
    notifyDataChanged();
    onSaved(res.data);
    onHide();
  };

  return (
    <Dialog header="Record a payment" visible={visible} onHide={onHide} modal dismissableMask style={{ width: '26rem' }}>
      <div className="flex flex-col gap-3 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Dropdown
            value={fromUserId}
            onChange={(e) => { if (e.value !== null) setFromUserId(e.value); }}
            options={opts}
            itemTemplate={memberOption}
            valueTemplate={(opt) => (opt ? memberOption(opt) : <span>Select</span>)}
            className="w-full sm:flex-1 sm:min-w-0"
          />
          <span className="text-xs text-muted-foreground text-center shrink-0 sm:px-1">paid</span>
          <Dropdown
            value={toUserId}
            onChange={(e) => { if (e.value !== null) setToUserId(e.value); }}
            options={opts}
            itemTemplate={memberOption}
            valueTemplate={(opt) => (opt ? memberOption(opt) : <span>Select</span>)}
            className="w-full sm:flex-1 sm:min-w-0"
          />
        </div>
        <InputNumber
          value={amount}
          onValueChange={(e) => setAmount(e.value ?? null)}
          mode="currency"
          currency={currency}
          locale="fi-FI"
          className="w-full"
          inputClassName="w-full text-xl font-semibold"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground w-12 shrink-0">Date</span>
          <Calendar value={date} onChange={(e) => e.value && setDate(e.value as Date)} dateFormat="dd.mm.yy" className="flex-1" />
        </div>
        {error && <Message severity="error" text={error} />}
        <ControlGroup aria-label="Settlement actions" className="justify-end mt-1">
          <Button label="Cancel" text onClick={onHide} disabled={saving} />
          <Button label="Record payment" severity="success" loading={saving} onClick={save} />
        </ControlGroup>
      </div>
    </Dialog>
  );
}
