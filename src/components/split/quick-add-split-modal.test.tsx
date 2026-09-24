// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight PrimeReact/action test doubles */
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
vi.mock('primereact/confirmdialog', () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock('primereact/dialog', () => ({ Dialog: ({ visible, children }: any) => visible ? <div role="dialog">{children}</div> : null }));
vi.mock('primereact/button', () => ({ Button: ({ label, onClick, disabled, loading, children, ...rest }: any) => <button type="button" disabled={disabled || loading} onClick={onClick} {...rest}>{label ?? children}</button> }));
vi.mock('primereact/inputtext', () => ({ InputText: (props: any) => <input {...props} /> }));
vi.mock('primereact/inputnumber', () => ({ InputNumber: ({ value, onValueChange, inputRef, ...props }: any) => <input ref={inputRef} value={value ?? ''} onChange={(e) => onValueChange({ value: Number(e.target.value) })} {...props} /> }));
vi.mock('primereact/dropdown', () => ({ Dropdown: ({ value, options, onChange, ...props }: any) => <select value={value} onChange={(e) => onChange({ value: e.target.value })} {...props}>{options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('primereact/calendar', () => ({ Calendar: ({ value }: any) => <input aria-label="Date" value={value?.toISOString?.().slice(0, 10) ?? ''} readOnly /> }));
vi.mock('primereact/message', () => ({ Message: ({ text }: any) => <div role="alert">{text}</div> }));
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
