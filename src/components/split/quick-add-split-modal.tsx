'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { useSession } from '@/lib/auth-client';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { confirmDialog } from 'primereact/confirmdialog';
import { MdAdd } from 'react-icons/md';
import { useToast } from '@/components/providers/toast-provider';
import { useCelebration } from '@/components/providers/celebration-provider';
import { getMySplitGroups, getMySplitLinkCandidates, createSplitExpense, setDefaultSplitGroup } from '@/lib/actions/split-groups';
import { getUserPreferences } from '@/lib/actions/user-preferences';
import { DelayedSkeleton } from '@/components/ui/delayed-loading';
import { findSplitDuplicateCandidates } from '@/lib/bank-split-match';
import { toCents, guessCategory } from '@/lib/split-utils';
import { SPLIT_CATEGORIES, formatCurrency } from '@/lib/constants';
import { SplitEditor, emptyDraft, resolveDraftSpec, type SplitDraft } from './split-editor';
import type { SplitGroup, SplitExpenseBankLink, SplitDuplicateCandidate, SplitLinkCandidate, Currency } from '@/types';
import type { BankSplitMatch } from '@/lib/bank-split-match';

/** Optional prefill applied each time the dialog opens (e.g. "Split this" from
 * a bank transaction). Amount is in the selected group's currency. */
export interface QuickAddSplitInitial {
  title?: string;
  amount?: number;
  date?: string; // YYYY-MM-DD
  category?: string;
  /** Stamps the created expense with a pointer back to its source bank
   * transaction ("Split this"). `ownerUserId` is stamped server-side. */
  bankLink?: Omit<SplitExpenseBankLink, 'ownerUserId'>;
  /** Existing suggestion to review before creating or linking anything. */
  reviewMatch?: BankSplitMatch;
}

/** 'YYYY-MM-DD' → local Date (never UTC parsing — the day must not shift). */
function parseIsoDate(iso: string): Date | null {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

interface QuickAddSplitModalProps {
  visible: boolean;
  onHide: () => void;
  onSaved?: () => void;
  initial?: QuickAddSplitInitial;
  onConfirmLink?: (match: BankSplitMatch) => Promise<void> | void;
}

/**
 * The fast "add a shared expense" path. Defaults to: your default group, you
 * paid, split equally, today — so a title + amount + Save is enough. The split
 * UI (presets + custom amounts/percentages + live preview) is the shared
 * <SplitEditor>, identical to the in-group add/edit dialogs.
 */
export function QuickAddSplitModal({ visible, onHide, onSaved, initial, onConfirmLink }: QuickAddSplitModalProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const myId = session?.user?.id ?? '';
  const toast = useToast();
  const { celebrate } = useCelebration();
  const amountRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [draft, setDraft] = useState<SplitDraft>(() => emptyDraft(myId));
  const [date, setDate] = useState<Date>(new Date());
  const [category, setCategory] = useState<string>('');
  const [bankLink, setBankLink] = useState<QuickAddSplitInitial['bankLink']>(undefined);
  const [defaultGroupId, setDefaultGroupId] = useState<string | undefined>(undefined);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingLink, setConfirmingLink] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [linkCandidates, setLinkCandidates] = useState<SplitLinkCandidate[]>([]);

  // Load groups + default-group preference when opened.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setGroupsLoading(true);
    (async () => {
      try {
        const [g, prefs] = await Promise.all([getMySplitGroups(), getUserPreferences()]);
        if (!active) return;
        if (!g.success) throw new Error(g.error ?? 'Could not load split groups');
        const list = g.data ?? [];
        setGroups(list);
        const preferred = prefs.success ? prefs.data?.defaultSplitGroupId : undefined;
        setDefaultGroupId(preferred);
        setGroupId(cur => list.some(x => x.id === cur) ? cur : (preferred && list.some(x => x.id === preferred) ? preferred : list[0]?.id ?? ''));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load split groups');
      } finally {
        if (active) setGroupsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  // Hints are advisory; the action repeats the check under the group lock.
  useEffect(() => {
    setLinkCandidates([]);
    if (!visible || !initial?.bankLink || initial.reviewMatch) return;
    let active = true;
    const month = (initial.date ?? initial.bankLink.bookingDate).slice(0, 7);
    void getMySplitLinkCandidates([month]).then(res => {
      if (active && res.success && res.data) setLinkCandidates(res.data);
    }).catch(() => { /* The authoritative save-time check remains available. */ });
    return () => { active = false; };
  }, [visible, initial]);

  // Reset transient fields each time the dialog opens (applying the optional
  // prefill, which is only read at open time — hence excluded from the deps).
  useEffect(() => {
    if (visible) {
      setTitle(initial?.title ?? '');
      setAmount(initial?.amount ?? null);
      setDraft(emptyDraft(myId));
      setDate(initial?.date ? parseIsoDate(initial.date) ?? new Date() : new Date());
      setCategory(initial?.category ?? '');
      setBankLink(initial?.bankLink);
      // Surface the prefilled date/category so the user sees what came along.
      setShowMore(!!(initial?.date || initial?.category));
      setError('');
      setConfirmingLink(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, myId]);

  // Switching groups can change the member set, so reset the split to the default.
  useEffect(() => {
    setDraft(emptyDraft(myId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);
  const effectiveCategory = category || (title ? guessCategory(title) : 'General');

  const reset = () => {
    setTitle('');
    setAmount(null);
    setDraft(emptyDraft(myId));
    // A bank link is one-shot — "add another" starts a fresh, unlinked expense
    // rather than pointing a second row at the same source transaction.
    setBankLink(undefined);
    setError('');
    setTimeout(() => amountRef.current?.focus(), 60);
  };

  const save = async (addAnother: boolean, acknowledgedIds: string[] = []) => {
    if (savingRef.current) return;
    if (!group) {
      setError('Pick a group');
      return;
    }
    if (bankLink && group.currency !== bankLink.currency) {
      setError(`Currency mismatch: this bank transaction is ${bankLink.currency}, but the selected group uses ${group.currency}.`);
      return;
    }
    if (!title.trim()) {
      setError('Add a description');
      return;
    }
    if (!amount || amount <= 0) {
      setError('Add an amount');
      return;
    }
    const { spec, error: splitError } = resolveDraftSpec(draft, group.members, toCents(amount), myId);
    if (!spec) {
      setError(splitError ?? 'Check the split');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const res = await createSplitExpense(group.id, {
        title: title.trim(),
        category: effectiveCategory,
        amountCents: toCents(amount),
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        split: spec,
        ...(bankLink ? { bankLink } : {}),
        ...(acknowledgedIds.length > 0 ? { acknowledgedDuplicateExpenseIds: acknowledgedIds } : {}),
      });
      savingRef.current = false;
      setSaving(false);
      if (!res.success) {
        const duplicateList = (res as typeof res & { duplicate?: SplitDuplicateCandidate[] }).duplicate ?? [];
        if (duplicateList.length > 0) {
          confirmDialog({
            header: 'Possible duplicate split',
            message: (
              <div className="space-y-2">
                <p>This transaction looks like it may already be in a split group. Do you want to add another expense anyway?</p>
                {duplicateList.map(duplicateDetails)}
              </div>
            ),
            acceptLabel: 'Add anyway',
            rejectLabel: 'Cancel',
            defaultFocus: 'reject',
            style: { width: 'min(32rem, calc(100vw - 2rem))' },
            acceptClassName: 'p-button-warning',
            accept: () => {
              void save(addAnother, [...new Set([...acknowledgedIds, ...duplicateList.map(candidate => candidate.expenseId)])]);
            },
          });
          return;
        }
        setError(res.error ?? 'Failed to add');
        toast.error('Could not add expense', res.error ?? 'Please try again.');
        return;
      }
      // Preselect this group next time the modal opens; fire-and-forget so it
      // never delays the success toast below.
      if (group.id !== defaultGroupId) void setDefaultSplitGroup(group.id).catch(() => {});
      // Checkmark pop works for both Save and Save & add another (the dialog can
      // stay open); the toast is the reduced-motion feedback. No row flash here —
      // the created row isn't on this screen.
      celebrate('checkmark');
      onSaved?.();
      toast.success('Added', title.trim());
      if (addAnother) reset();
      else onHide();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Please try again.';
      setError(message);
      toast.error('Could not add expense', message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const duplicateDetails = (candidate: SplitDuplicateCandidate) => (
      <div key={candidate.expenseId} className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="font-medium break-words">{candidate.title}</div>
      <div className="text-xs opacity-70">{candidate.groupName} · {dateLabel(candidate.date)} · {formatCurrency(candidate.amountCents / 100, candidate.currency as Currency)}</div>
    </div>
  );

  const review = initial?.reviewMatch;
  const reviewMatches = review ? [review, ...(review.related ?? [])] : [];
  const bankCurrency = initial?.bankLink?.currency;
  const currencyMismatch = !!review && !!bankCurrency && review.currency !== bankCurrency;
  const dateLabel = (value: string) => {
    try { return format(parseISO(value.slice(0, 10)), 'dd.MM.yyyy'); } catch { return value.slice(0, 10); }
  };

  const duplicateHints = bankLink ? findSplitDuplicateCandidates({
    ...bankLink, id: bankLink.txId, transactionDate: initial?.date,
  }, linkCandidates, groupId) : [];
  const noGroups = visible && groups.length === 0;

  return (
    <>
      <Dialog
        header={review ? (review.kind === 'linked' ? 'Linked split expenses' : 'Review split link') : 'Add expense'}
        visible={visible}
        onHide={() => { if (!saving && !confirmingLink) onHide(); }}
        closable={!saving && !confirmingLink}
        modal
        dismissableMask
        style={{ width: '32rem', maxWidth: 'calc(100vw - 1rem)', maxHeight: 'calc(100dvh - 1rem)' }}
        contentClassName="pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        {review ? (
          <div className="flex flex-col gap-4">
            <Message severity={review.kind === 'linked' ? 'info' : 'warn'} text={review.kind === 'linked'
              ? 'This bank transaction is linked to these existing expenses.'
              : review.kind === 'recovered'
                ? 'The bank appears to have booked a transaction you split while it was pending. Confirm to reconnect the existing expense.'
                : 'Check the details below. Confirming links the existing expense without adding another one.'} />
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-900/60 dark:bg-blue-950/20">
              <div className="text-xs uppercase tracking-wide opacity-60">Bank transaction</div>
              <div className="mt-1 font-medium">{initial?.bankLink?.counterpartyName ?? 'Unknown merchant'}</div>
              <div className="mt-1 opacity-70">{initial?.date ? dateLabel(initial.date) : initial?.bankLink?.bookingDate ? dateLabel(initial.bankLink.bookingDate) : '—'} · {initial?.bankLink ? formatCurrency(Math.abs(initial.bankLink.amount), initial.bankLink.currency) : '—'}</div>
            </div>
            {currencyMismatch && <Message severity="error" text={`Currency mismatch: bank transaction is ${bankCurrency}, existing expense is ${review.currency}. Linking is disabled.`} />}
            <div className="space-y-2">
              {reviewMatches.map((candidate, index) => (
                <div key={candidate.expenseId} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="text-xs uppercase tracking-wide opacity-60">{candidate.kind === 'linked' ? 'Linked expense' : index === 0 ? 'Possible existing split' : 'Also matched'}</div>
                  <div className="mt-1 text-lg font-semibold break-words">{candidate.title}</div>
                  <div className="mt-1 text-sm opacity-70">{candidate.groupName} · {dateLabel(candidate.date)} · {formatCurrency(candidate.amountCents / 100, candidate.currency as Currency)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button label="Open expense" icon="pi pi-external-link" outlined onClick={() => router.push(`/split/${candidate.groupId}?expense=${candidate.expenseId}&month=${candidate.date.slice(0, 7)}`)} />
                    {candidate.kind !== 'linked' && <Button label="Confirm link" icon="pi pi-link" loading={confirmingLink} disabled={confirmingLink || !onConfirmLink || candidate.currency !== bankCurrency} onClick={async () => {
                      if (!onConfirmLink) return;
                      setConfirmingLink(true);
                      setError('');
                      try {
                        await onConfirmLink(candidate);
                        toast.success('Split link confirmed', `${candidate.title} is now linked to this bank transaction.`);
                        onSaved?.();
                        onHide();
                      } catch (e) {
                        const message = e instanceof Error ? e.message : 'Could not confirm the split link';
                        setError(message);
                        toast.error('Could not confirm split link', message);
                      } finally {
                        setConfirmingLink(false);
                      }
                    }} />}
                  </div>
                </div>
              ))}
            </div>
            {error && <Message severity="error" text={error} />}
            <Button label="Cancel" text onClick={onHide} className="self-start min-h-[44px]" />
          </div>
        ) : groupsLoading ? (
          <DelayedSkeleton><div className="h-48 w-full animate-pulse rounded-lg bg-surface-100 dark:bg-surface-800" /></DelayedSkeleton>
        ) : noGroups ? (
          <div className="py-6 text-center text-gray-600 dark:text-gray-300">
            {error ? <Message severity="error" text={error} /> : <p className="mb-3">You don&apos;t have a split group yet.</p>}
            <Button label="Create a group" icon={<MdAdd />} onClick={onHide} link />
            <p className="text-sm text-gray-400 mt-1">Head to the Split tab to create one.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Group selector */}
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="shrink-0">With you and:</span>
              <Dropdown
                value={groupId}
                onChange={(e) => setGroupId(e.value)}
                options={groups.map((g) => ({ label: `${g.emoji ? g.emoji + ' ' : ''}${g.name}`, value: g.id }))}
                className="flex-1 min-w-0"
              />
            </div>

            {bankLink && group && group.currency !== bankLink.currency && (
              <Message severity="error" text={`Choose a ${bankLink.currency} group to split this transaction. This group uses ${group.currency}.`} />
            )}
            {bankLink && duplicateHints.length > 0 && (
              <div className="space-y-2" aria-label="Possible existing expenses">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">This transaction may already be split</p>
                {duplicateHints.map(candidate => (
                  <div key={candidate.expenseId}>
                    {duplicateDetails(candidate)}
                    <Button label="Open existing expense" text className="min-h-[44px]" onClick={() => router.push(`/split/${candidate.groupId}?expense=${candidate.expenseId}&month=${candidate.date.slice(0, 7)}`)} />
                  </div>
                ))}
                <p className="text-xs text-gray-500 dark:text-gray-400">Saving will ask you to confirm before adding another expense.</p>
              </div>
            )}

            {/* Amount + description — the two essentials, amount first so the
                keyboard opens straight onto the number people care about most. */}
            <InputNumber
              inputRef={amountRef}
              value={amount}
              onValueChange={(e) => setAmount(e.value ?? null)}
              mode="currency"
              currency={bankLink?.currency ?? group?.currency ?? 'EUR'}
              locale="fi-FI"
              placeholder="0,00"
              inputClassName="w-full text-2xl font-semibold"
              className="w-full"
              autoFocus
              inputMode="decimal"
              onKeyDown={(e) => {
                if (e.key === 'Enter') save(false);
              }}
            />
            <InputText
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What was it for?"
              className="w-full text-lg"
            />

            {/* Split editor (presets + custom + live preview) */}
            {group && (
              <SplitEditor
                members={group.members}
                myId={myId}
                currency={group.currency}
                amountCents={amount != null ? toCents(amount) : null}
                value={draft}
                onChange={setDraft}
              />
            )}

            {/* More options */}
            {showMore ? (
              <div className="animate-fade-in flex flex-col gap-3 border-t pt-3 border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 w-20 shrink-0">Date</span>
                  <Calendar value={date} onChange={(e) => e.value && setDate(e.value as Date)} dateFormat="dd.mm.yy" className="flex-1 min-w-0" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 w-20 shrink-0">Category</span>
                  <Dropdown
                    value={effectiveCategory}
                    onChange={(e) => setCategory(e.value)}
                    options={SPLIT_CATEGORIES.filter((c) => c !== 'Payment')}
                    filter
                    className="flex-1 min-w-0"
                  />
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setShowMore(true)} className="text-sm text-gray-500 hover:underline self-start">
                More options (date, category)
              </button>
            )}

            {error && <Message severity="error" text={error} />}

            <div className="flex gap-2 pt-1">
              <Button label="Save" className="flex-1" loading={saving} disabled={!!bankLink && group?.currency !== bankLink.currency} onClick={() => save(false)} severity="success" />
              <Button label="Save & add another" outlined onClick={() => save(true)} disabled={saving || (!!bankLink && group?.currency !== bankLink.currency)} />
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
