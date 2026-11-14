// @vitest-environment jsdom
import React from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettleUpDialog } from './settle-up-dialog';
import { SplitExpenseDialog } from './split-expense-dialog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ visible, children, footer, onHide }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode; onHide: () => void }) =>
    visible ? <div role="dialog"><button onClick={onHide}>Close dialog</button>{children}<footer>{footer}</footer></div> : null,
}));
vi.mock('@/components/ui/page-header', () => ({ ControlGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/input-number', () => ({
  InputNumber: ({ value, onValueChange }: { value: number | null; onValueChange: (event: { value: number | null }) => void }) => (
    <input aria-label="Amount" value={value ?? ''} onChange={(event) => onValueChange({ value: Number(event.target.value) })} />
  ),
}));
vi.mock('@/components/ui/input-text', () => ({ InputText: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/dropdown', () => ({
  Dropdown: ({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (event: { value: string }) => void }) => (
    <select value={value} onChange={(event) => onChange({ value: event.target.value })}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@/components/ui/calendar', () => ({ Calendar: () => <input aria-label="Date" readOnly /> }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onClick, loading, disabled }: { label: string; onClick?: () => void; loading?: boolean; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={loading || disabled}>{label}</button>
  ),
}));
vi.mock('@/components/ui/message', () => ({ Message: ({ text }: { text: string }) => <div role="alert">{text}</div> }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ error: toastError }) }));
vi.mock('@/lib/hooks/use-media-query', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/hooks/use-user-profiles', () => ({ useUserProfiles: () => ({}) }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span /> }));
vi.mock('./split-editor', () => ({
  SplitEditor: () => <div data-testid="split-editor" />,
  emptyDraft: () => ({ paidByUserId: 'alex', splitMode: 'equal' }),
  draftFromExpense: () => ({ paidByUserId: 'alex', splitMode: 'equal' }),
  resolveDraftSpec: () => ({ spec: { paidByUserId: 'alex', splitMode: 'equal' } }),
}));
vi.mock('@/lib/actions/split-groups', () => ({
  recordSettleUp: vi.fn(),
  createSplitExpense: vi.fn(),
  updateSplitExpense: vi.fn(),
}));
vi.mock('@/lib/hooks/use-data-refresh', () => ({ notifyDataChanged: vi.fn() }));

const members = [
  { userId: 'alex', name: 'Alex', email: 'alex@example.com', role: 'owner' as const },
  { userId: 'sam', name: 'Sam', email: 'sam@example.com', role: 'member' as const },
];

it('keeps settlement edits when refreshed balances and member objects arrive while open', () => {
  const props = {
    visible: true,
    onHide: vi.fn(),
    groupId: 'group-1',
    members,
    currency: 'EUR' as const,
    myId: 'alex',
    balances: [
      { userId: 'alex', name: 'Alex', netCents: -10_000 },
      { userId: 'sam', name: 'Sam', netCents: 10_000 },
    ],
    onSaved: vi.fn(),
  };
  const view = render(<SettleUpDialog {...props} />);
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12.34' } });
  const selects = screen.getAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: 'sam' } });
  fireEvent.change(selects[1], { target: { value: 'alex' } });

  view.rerender(<SettleUpDialog
    {...props}
    members={members.map((member) => ({ ...member }))}
    balances={[
      { userId: 'alex', name: 'Alex', netCents: 4_000 },
      { userId: 'sam', name: 'Sam', netCents: -4_000 },
    ]}
  />);

  expect(screen.getByLabelText('Amount')).toHaveValue('12.34');
  expect(screen.getAllByRole('combobox').map((select) => (select as HTMLSelectElement).value)).toEqual(['sam', 'alex']);
});

it('keeps an expense draft when the same saved row and member list are refreshed', () => {
  const expense = {
    kind: 'expense' as const,
    id: 'expense-1',
    groupId: 'group-1',
    date: '2026-10-10',
    currency: 'EUR' as const,
    netByUserId: { alex: 500, sam: -500 },
    source: 'manual' as const,
    createdByUserId: 'alex',
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    title: 'Saved title',
    category: 'General',
    amountCents: 1_000,
    paidBy: [{ userId: 'alex', amountCents: 1_000 }],
    owed: [{ userId: 'alex', amountCents: 500 }, { userId: 'sam', amountCents: 500 }],
  };
  const props = {
    visible: true,
    onHide: vi.fn(),
    groupId: 'group-1',
    members,
    currency: 'EUR' as const,
    myId: 'alex',
    expense,
    onSaved: vi.fn(),
  };
  const view = render(<SplitExpenseDialog {...props} />);
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved draft title' } });
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '18.75' } });

  view.rerender(<SplitExpenseDialog
    {...props}
    expense={{ ...expense, title: 'Fresh server title', updatedAt: '2026-11-01T00:00:00.000Z' }}
    members={members.map((member) => ({ ...member }))}
  />);

  expect(screen.getByLabelText('Description')).toHaveValue('Unsaved draft title');
  expect(screen.getByLabelText('Amount')).toHaveValue('18.75');
});

const editedExpense = {
  kind: 'expense' as const, id: 'expense-1', groupId: 'group-1', date: '2026-10-10', currency: 'EUR' as const,
  netByUserId: { alex: 500, sam: -500 }, source: 'manual' as const, createdByUserId: 'alex',
  createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z',
  title: 'Saved title', category: 'General', amountCents: 1000,
  paidBy: [{ userId: 'alex', amountCents: 1000 }],
  owed: [{ userId: 'alex', amountCents: 500 }, { userId: 'sam', amountCents: 500 }],
};
const editorProps = { visible: true, onHide: vi.fn(), groupId: 'group-1', members, currency: 'EUR' as const, myId: 'alex', onSaved: vi.fn() };

it('shows delete only for an existing expense with a delete callback', () => {
  const onDelete = vi.fn();
  const view = render(<SplitExpenseDialog {...editorProps} onDelete={onDelete} />);
  expect(screen.queryByRole('button', { name: 'Delete expense' })).not.toBeInTheDocument();
  view.rerender(<SplitExpenseDialog {...editorProps} expense={editedExpense} onDelete={onDelete} />);
  expect(screen.getByRole('button', { name: 'Delete expense' })).toBeInTheDocument();
  view.rerender(<SplitExpenseDialog {...editorProps} expense={editedExpense} />);
  expect(screen.queryByRole('button', { name: 'Delete expense' })).not.toBeInTheDocument();
});

it('cancels without saving', async () => {
  const { updateSplitExpense } = await import('@/lib/actions/split-groups');
  vi.mocked(updateSplitExpense).mockClear();
  const onHide = vi.fn();
  render(<SplitExpenseDialog {...editorProps} expense={editedExpense} onHide={onHide} />);
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onHide).toHaveBeenCalledTimes(1);
  expect(updateSplitExpense).not.toHaveBeenCalled();
});

it('keeps a draft on cancelled or failed delete and closes only on success', async () => {
  const onHide = vi.fn();
  const onDelete = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Delete failed')).mockResolvedValueOnce(true);
  render(<SplitExpenseDialog {...editorProps} expense={editedExpense} onHide={onHide} onDelete={onDelete} />);
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete expense' })).not.toBeDisabled());
  expect(onHide).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Description')).toHaveValue('Draft');
  fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
  expect(await screen.findByText('Delete failed')).toBeInTheDocument();
  expect(screen.getByLabelText('Description')).toHaveValue('Draft');
  fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
  await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
});

it('blocks conflicting actions while deletion is pending', async () => {
  let resolve!: (value: boolean) => void;
  const onDelete = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  const onHide = vi.fn();
  render(<SplitExpenseDialog {...editorProps} expense={editedExpense} onHide={onHide} onDelete={onDelete} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onHide).not.toHaveBeenCalled();
  resolve(false);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete expense' })).not.toBeDisabled());
});

it('recovers from a thrown save without closing or losing the draft', async () => {
  const { updateSplitExpense } = await import('@/lib/actions/split-groups');
  vi.mocked(updateSplitExpense).mockRejectedValueOnce(new Error('Save failed'));
  const onHide = vi.fn();
  render(<SplitExpenseDialog {...editorProps} expense={editedExpense} onHide={onHide} />);
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Save failed')).toBeInTheDocument();
  expect(screen.getByLabelText('Description')).toHaveValue('Draft');
  expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  expect(onHide).not.toHaveBeenCalled();
});

it('announces a rejected save response and preserves the draft', async () => {
  const { updateSplitExpense } = await import('@/lib/actions/split-groups');
  vi.mocked(updateSplitExpense).mockResolvedValueOnce({ success: false, error: 'Save rejected' });
  toastError.mockClear();
  const onHide = vi.fn();
  render(<SplitExpenseDialog {...editorProps} expense={editedExpense} onHide={onHide} />);
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Save rejected')).toBeInTheDocument();
  expect(toastError).toHaveBeenCalledWith('Could not save expense', 'Save rejected');
  expect(screen.getByLabelText('Description')).toHaveValue('Draft');
  expect(onHide).not.toHaveBeenCalled();
});
