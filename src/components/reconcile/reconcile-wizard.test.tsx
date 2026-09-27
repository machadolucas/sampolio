// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { createMockAccount, createMockInvestment } from '@/test/mocks';
import { ReconcileWizard } from './reconcile-wizard';

const ok = <T,>(data: T) => Promise.resolve({ success: true, data });

const account = createMockAccount({ id: 'acc-1', name: 'Main Checking' });
const investment = createMockInvestment({ id: 'inv-1', name: 'Index Fund' });

vi.mock('@/lib/actions/accounts', () => ({
  getAccounts: vi.fn(() => ok([account])),
}));
vi.mock('@/lib/actions/investments', () => ({
  getInvestmentAccounts: vi.fn(() => ok([investment])),
}));
vi.mock('@/lib/actions/receivables', () => ({
  getReceivables: vi.fn(() => ok([])),
}));
vi.mock('@/lib/actions/debts', () => ({
  getDebts: vi.fn(() => ok([])),
}));
vi.mock('@/lib/actions/projection', () => ({
  getProjection: vi.fn(() => ok({ monthly: [] })),
}));
vi.mock('@/lib/actions/reconciliation', () => ({
  startReconciliationSession: vi.fn(() => ok({ id: 'session-1' })),
  createBalanceSnapshot: vi.fn(() => ok({})),
  completeReconciliationSession: vi.fn(() => ok({})),
  applyReconciliationBalances: vi.fn(() => ok(undefined)),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => toastMock,
}));
vi.mock('@/components/layout/app-layout', () => ({
  useAppContext: () => null,
}));

import {
  startReconciliationSession,
  createBalanceSnapshot,
  applyReconciliationBalances,
  completeReconciliationSession,
} from '@/lib/actions/reconciliation';

function renderWizard() {
  return renderWithProviders(<ReconcileWizard visible onHide={vi.fn()} />);
}

describe('ReconcileWizard', () => {
  it('renders step 1 with the fetched entities summarized', async () => {
    renderWizard();

    expect(await screen.findByText(/Time for a quick check-in/)).toBeInTheDocument();
    // Steps header ('Month' also labels the month dropdown, so allow multiple)
    expect(screen.getAllByText('Month').length).toBeGreaterThan(0);
    expect(screen.getByText('Balances')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    // Entity counts from the mocked fetches
    expect(screen.getByText('1 Cash Accounts')).toBeInTheDocument();
    expect(screen.getByText('1 Investments')).toBeInTheDocument();
    expect(screen.getByText('0 Receivables')).toBeInTheDocument();
    expect(screen.getByText('0 Debts')).toBeInTheDocument();
  });

  it('advances through balances to the review step with a confirm affordance', async () => {
    renderWizard();
    await screen.findByText(/Time for a quick check-in/);

    // Step 1 → 2: starts the reconciliation session
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText(/Check your actual balances for/)).toBeInTheDocument();
    expect(startReconciliationSession).toHaveBeenCalledTimes(1);
    // Fetched entities are listed with pre-filled balances
    expect(screen.getByText('Main Checking')).toBeInTheDocument();
    expect(screen.getByText('Index Fund')).toBeInTheDocument();

    // Step 2 → 3: review & confirm
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText(/Reconciliation Summary for/)).toBeInTheDocument();
    // Nothing was changed, so the zero-variance note shows
    expect(screen.getByText(/All balances match/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save check-in/ })
    ).toBeInTheDocument();

    // Back returns to the balances step
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(await screen.findByText(/Check your actual balances for/)).toBeInTheDocument();
  });

  it('does not report success when a snapshot write fails', async () => {
    vi.mocked(createBalanceSnapshot).mockClear();
    vi.mocked(applyReconciliationBalances).mockClear();
    vi.mocked(completeReconciliationSession).mockClear();
    toastMock.show.mockClear();
    toastMock.error.mockClear();
    vi.mocked(createBalanceSnapshot)
      .mockResolvedValueOnce({ success: true, data: {} } as never)
      .mockResolvedValueOnce({ success: false, error: 'Disk full' } as never);

    renderWizard();
    await screen.findByText(/Time for a quick check-in/);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByText(/Check your actual balances for/);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByText(/Reconciliation Summary for/);
    fireEvent.click(screen.getByRole('button', { name: /Save check-in/ }));

    expect(await screen.findByText(/Could not save the balance for Index Fund \(Disk full\)/)).toBeInTheDocument();
    expect(applyReconciliationBalances).not.toHaveBeenCalled();
    expect(completeReconciliationSession).not.toHaveBeenCalled();
    expect(toastMock.show).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('Check-in not saved', expect.stringContaining('Index Fund'));
  });

  it('does not close on a mask click (typed balances survive)', async () => {
    const onHide = vi.fn();
    renderWithProviders(<ReconcileWizard visible onHide={onHide} />);
    await screen.findByText(/Time for a quick check-in/);
    const mask = document.querySelector('.p-dialog-mask');
    expect(mask).not.toBeNull();
    fireEvent.mouseDown(mask!);
    fireEvent.click(mask!);
    expect(onHide).not.toHaveBeenCalled();
  });
});
