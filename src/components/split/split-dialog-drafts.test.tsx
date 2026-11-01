// @vitest-environment jsdom
import React from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettleUpDialog } from './settle-up-dialog';
import { SplitExpenseDialog } from './split-expense-dialog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div role="dialog">{children}</div> : null,
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
