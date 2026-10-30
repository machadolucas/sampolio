// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight nonnumeric UI/action test doubles */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuickAddSplitModal } from './quick-add-split-modal';
import type { BankSplitMatch } from '@/lib/bank-split-match';

const mocks = vi.hoisted(() => ({
  createSplitExpense: vi.fn(),
  getMySplitGroups: vi.fn(),
  getUserPreferences: vi.fn(),
  setDefaultSplitGroup: vi.fn(),
  getMySplitLinkCandidates: vi.fn(),
  confirmDialog: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/hooks/use-media-query', () => ({ useIsMobile: () => false }));
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn(), show: vi.fn() }) }));
vi.mock('@/components/providers/celebration-provider', () => ({ useCelebration: () => ({ celebrate: vi.fn() }) }));
vi.mock('@/lib/actions/split-groups', () => ({
  createSplitExpense: mocks.createSplitExpense,
  getMySplitGroups: mocks.getMySplitGroups,
  setDefaultSplitGroup: mocks.setDefaultSplitGroup,
  getMySplitLinkCandidates: mocks.getMySplitLinkCandidates,
}));
vi.mock('@/lib/actions/user-preferences', () => ({ getUserPreferences: mocks.getUserPreferences }));
vi.mock('@/components/ui/confirm-dialog', () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ visible, children }: any) => visible ? <div role="dialog">{children}</div> : null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, onClick, disabled, loading, children, ...rest }: any) => <button type="button" disabled={disabled || loading} onClick={onClick} {...rest}>{label ?? children}</button> }));
vi.mock('@/components/ui/input-text', () => ({ InputText: (props: any) => <input {...props} /> }));
vi.mock('@/components/ui/dropdown', () => ({ Dropdown: ({ value, options, onChange, ...props }: any) => <select value={value} onChange={(e) => onChange({ value: e.target.value })} {...props}>{options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('@/components/ui/calendar', () => ({ Calendar: ({ value }: any) => <input aria-label="Date" value={value?.toISOString?.().slice(0, 10) ?? ''} readOnly /> }));
vi.mock('@/components/ui/message', () => ({ Message: ({ text }: any) => <div role="alert">{text}</div> }));
vi.mock('./split-editor', () => ({
  SplitEditor: () => <div data-testid="split-editor" />,
  emptyDraft: () => ({ paidByUserId: 'u1', splitMode: 'equal' }),
  resolveDraftSpec: () => ({ spec: { paidByUserId: 'u1', splitMode: 'equal' } }),
}));

const group = {
  id: 'g1', name: 'Household', emoji: '🏠', currency: 'EUR', isArchived: false,
  members: [
    { userId: 'u1', name: 'Alex', email: 'alex@example.com', role: 'owner' },
    { userId: 'u2', name: 'Sam', email: 'sam@example.com', role: 'member' },
  ],
};

const bankLink = { txId: 'tx1', linkedAccountId: 'a1', bookingDate: '2026-05-08', amount: -24.5, currency: 'EUR', counterpartyName: 'Corner Cafe' } as const;

function savedExpense(
  id: string,
  linked = true,
  title = 'Corner Cafe',
  amountCents = 2450,
) {
  const half = amountCents / 2;
  return {
    id,
    groupId: group.id,
    kind: 'expense' as const,
    date: '2026-05-08',
    currency: 'EUR' as const,
    netByUserId: { u1: half, u2: -half },
    source: 'manual' as const,
    createdByUserId: 'u1',
    createdAt: '2026-05-08T10:00:00.000Z',
    updatedAt: '2026-05-08T10:00:00.000Z',
    title,
    category: 'Food',
    amountCents,
    paidBy: [{ userId: 'u1', amountCents }],
    owed: [
      { userId: 'u1', amountCents: half },
      { userId: 'u2', amountCents: half },
    ],
    splitMode: 'equal' as const,
    ...(linked ? { bankLink: { ...bankLink, ownerUserId: 'u1' } } : {}),
  };
}

function openModal(initial: any = { title: 'Corner Cafe', amount: 24.5, bankLink }) {
  return render(<QuickAddSplitModal visible onHide={vi.fn()} initial={initial} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMySplitGroups.mockResolvedValue({ success: true, data: [group] });
  mocks.getUserPreferences.mockResolvedValue({ success: true, data: {} });
  mocks.setDefaultSplitGroup.mockResolvedValue({ success: true });
  mocks.getMySplitLinkCandidates.mockResolvedValue({ success: true, data: [] });
  mocks.createSplitExpense.mockResolvedValue({ success: true, data: { id: 'new' } });
});

describe('QuickAddSplitModal duplicate and review UX', () => {
  it('shows duplicate details, cancel does not retry, and accept retries with exact ids', async () => {
    mocks.createSplitExpense.mockResolvedValueOnce({ success: false, error: 'duplicate', duplicate: [
      { expenseId: 'e1', groupId: 'g1', groupName: 'Household', title: 'Dinner', date: '2026-05-08', amountCents: 2450, currency: 'EUR', kind: 'heuristic' },
      { expenseId: 'e2', groupId: 'g2', groupName: 'Trip', title: 'Dinner', date: '2026-05-09', amountCents: 2450, currency: 'EUR', kind: 'heuristic' },
    ] });
    openModal();
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(mocks.confirmDialog).toHaveBeenCalled());
    const prompt = mocks.confirmDialog.mock.calls[0][0];
    expect(prompt.message).toBeTruthy();
    prompt.reject?.();
    expect(mocks.createSplitExpense).toHaveBeenCalledTimes(1);
    prompt.accept?.();
    await waitFor(() => expect(mocks.createSplitExpense).toHaveBeenCalledTimes(2));
    expect(mocks.createSplitExpense.mock.calls[1][1].acknowledgedDuplicateExpenseIds).toEqual(['e1', 'e2']);
  });

  it('keeps Save & add another semantics and restores controls after an override failure', async () => {
    mocks.createSplitExpense.mockResolvedValueOnce({ success: false, duplicate: [{ expenseId: 'e1', groupId: 'g1', groupName: 'Household', title: 'Dinner', date: '2026-05-08', amountCents: 2450, currency: 'EUR', kind: 'heuristic' }] });
    mocks.createSplitExpense.mockResolvedValueOnce({ success: false, error: 'Network failed' });
    openModal();
    const saveAnother = await screen.findByRole('button', { name: 'Save & add another' });
    await waitFor(() => expect(saveAnother).not.toBeDisabled());
    fireEvent.click(saveAnother);
    await waitFor(() => expect(mocks.confirmDialog).toHaveBeenCalled());
    mocks.confirmDialog.mock.calls[0][0].accept();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network failed'));
    expect(screen.getByRole('button', { name: 'Save & add another' })).not.toBeDisabled();
  });

  it('locks the save action while the request is in flight', async () => {
    let resolve!: (value: any) => void;
    mocks.createSplitExpense.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    openModal();
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.createSplitExpense).toHaveBeenCalledTimes(1);
    resolve({ success: true, data: { id: 'new' } });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
  });

  it('shows the selected bank and expense details and keeps confirmation errors visible', async () => {
    const match: BankSplitMatch = { kind: 'heuristic', expenseId: 'e1', groupId: 'g1', groupName: 'Household', title: 'Dinner', date: '2026-05-08', amountCents: 2450, currency: 'EUR' };
    const onConfirmLink = vi.fn().mockRejectedValue(new Error('Link expired'));
    render(<QuickAddSplitModal visible onHide={vi.fn()} initial={{ bankLink, reviewMatch: match }} onConfirmLink={onConfirmLink} />);
    expect(await screen.findByText('Corner Cafe')).toBeInTheDocument();
    expect(screen.getByText('Dinner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm link' }));
    await waitFor(() => expect(screen.getByText('Link expired')).toBeInTheDocument());
    expect(mocks.createSplitExpense).not.toHaveBeenCalled();
  });
});

describe('QuickAddSplitModal Enter-to-save', () => {
  it('saves the typed amount on Enter, not the stale prefilled one', async () => {
    openModal();
    const input = await screen.findByPlaceholderText('0,00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.change(input, { target: { value: '30,75 €' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.createSplitExpense).toHaveBeenCalledTimes(1));
    expect(mocks.createSplitExpense.mock.calls[0][1].amountCents).toBe(3075);
  });

  it('saves a freshly typed amount on Enter instead of reporting a missing amount', async () => {
    openModal({ title: 'Lunch' });
    const input = await screen.findByPlaceholderText('0,00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.change(input, { target: { value: '12,50' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.createSplitExpense).toHaveBeenCalledTimes(1));
    expect(mocks.createSplitExpense.mock.calls[0][1].amountCents).toBe(1250);
    expect(screen.queryByText('Add an amount')).not.toBeInTheDocument();
  });
});

describe('QuickAddSplitModal save callbacks', () => {
  it('passes the saved bank-linked expense and group to onSaved before closing', async () => {
    const expense = savedExpense('saved-bank-expense');
    const onSaved = vi.fn();
    const events: string[] = [];
    const onHide = vi.fn(() => events.push('hide'));
    onSaved.mockImplementation(() => events.push('saved'));
    mocks.createSplitExpense.mockResolvedValueOnce({ success: true, data: expense });

    render(<QuickAddSplitModal visible onHide={onHide} onSaved={onSaved} initial={{ title: 'Corner Cafe', amount: 24.5, bankLink }} />);
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(expense, { id: group.id, name: group.name });
    expect(events).toEqual(['saved', 'hide']);
  });

  it('keeps Save & add another open and omits the one-shot bank link on the next save', async () => {
    const firstExpense = savedExpense('saved-bank-expense');
    const secondExpense = savedExpense('saved-manual-expense', false, 'Manual lunch', 1800);
    const onSaved = vi.fn();
    const onHide = vi.fn();
    mocks.createSplitExpense
      .mockResolvedValueOnce({ success: true, data: firstExpense })
      .mockResolvedValueOnce({ success: true, data: secondExpense });

    render(<QuickAddSplitModal visible onHide={onHide} onSaved={onSaved} initial={{ title: 'Corner Cafe', amount: 24.5, bankLink }} />);
    const addAnother = await screen.findByRole('button', { name: 'Save & add another' });
    await waitFor(() => expect(addAnother).not.toBeDisabled());
    fireEvent.click(addAnother);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(firstExpense, { id: group.id, name: group.name }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onHide).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('What was it for?')).toHaveValue('');
    expect(screen.getByPlaceholderText('0,00')).toHaveValue('');

    fireEvent.change(screen.getByPlaceholderText('What was it for?'), { target: { value: 'Manual lunch' } });
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '18,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.createSplitExpense).toHaveBeenCalledTimes(2));
    expect(mocks.createSplitExpense.mock.calls[1][1]).not.toHaveProperty('bankLink');
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(secondExpense, { id: group.id, name: group.name }));
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('does not call onSaved when duplicate confirmation is cancelled', async () => {
    const onSaved = vi.fn();
    const onHide = vi.fn();
    mocks.createSplitExpense.mockResolvedValueOnce({
      success: false,
      error: 'duplicate',
      duplicate: [{ expenseId: 'e1', groupId: 'g1', groupName: 'Household', title: 'Dinner', date: '2026-05-08', amountCents: 2450, currency: 'EUR', kind: 'heuristic' }],
    });

    render(<QuickAddSplitModal visible onHide={onHide} onSaved={onSaved} initial={{ title: 'Corner Cafe', amount: 24.5, bankLink }} />);
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(() => expect(mocks.confirmDialog).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the dialog open and skips onSaved when a save fails', async () => {
    const onSaved = vi.fn();
    const onHide = vi.fn();
    mocks.createSplitExpense.mockResolvedValueOnce({ success: false, error: 'Network failed' });

    render(<QuickAddSplitModal visible onHide={onHide} onSaved={onSaved} initial={{ title: 'Corner Cafe', amount: 24.5, bankLink }} />);
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    expect(await screen.findByText('Network failed')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });
});
