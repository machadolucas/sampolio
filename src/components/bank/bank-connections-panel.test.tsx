// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDemoMask } from "@/lib/demo-mode";
import { BankConnectionsPanel } from "./bank-connections-panel";

const device = vi.hoisted(() => ({
  on: false,
  listeners: new Set<() => void>(),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/components/layout/app-layout", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAppContext: () => ({
      demoMasked: useSyncExternalStore(
        (listener) => {
          device.listeners.add(listener);
          return () => {
            device.listeners.delete(listener);
          };
        },
        () => device.on,
      ),
    }),
  };
});
vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "dark" }),
}));
vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => toast,
}));
vi.mock("@/lib/actions/accounts", () => ({
  getAccounts: vi.fn(async () => ({ success: true, data: [] })),
}));
vi.mock("@/lib/actions/bank", () => ({
  getBankFeatureStatus: vi.fn(async () => ({
    success: true,
    data: { configured: true },
  })),
  getBankConnections: vi.fn(async () => ({
    success: true,
    data: [
      {
        id: "synthetic-bank",
        aspspName: "Synthetic bank",
        status: "active",
        validUntil: "2030-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        linkedAccounts: [
          {
            id: "synthetic-link",
            connectionId: "synthetic-bank",
            accountUid: "synthetic",
            name: "Synthetic current account",
            currency: "EUR",
            accountRole: "cash",
            lastBalance: 2400,
          },
        ],
      },
    ],
  })),
  listBankAspsps: vi.fn(),
  startBankConnection: vi.fn(),
  refreshBankConnection: vi.fn(),
  reconnectBankConnection: vi.fn(),
  disconnectBankConnection: vi.fn(),
  updateBankAccountLink: vi.fn(),
}));
afterEach(() => {
  device.on = false;
  setDemoMask(false);
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});
function toggle(on: boolean) {
  act(() => {
    setDemoMask(on);
    device.on = on;
    device.listeners.forEach((listener) => listener());
  });
}
describe("populated bank configuration material and privacy", () => {
  it("keeps cached bank cards on themed surfaces and immediately updates every displayed balance", async () => {
    const { container } = render(<BankConnectionsPanel />);
    await screen.findByText("Synthetic current account");
    const card = container.querySelector('[data-slot="bank-account-config"]')!;
    expect(card).toHaveClass("bg-muted", "border-border");
    expect(card.className).not.toMatch(/(?:bg|border)-(?:gray|slate|blue)-/);
    expect(card.textContent).toMatch(/2\s?400,00/);
    toggle(true);
    expect(card.textContent).toContain("✱✱✱");
    expect(card.textContent).not.toMatch(/2\s?400,00/);
    toggle(false);
    expect(card.textContent).not.toContain("✱✱✱");
    expect(card.textContent).toMatch(/2\s?400,00/);
  });
});


describe("bank connection feedback", () => {
  it("shows cancellation as information and preserves unrelated URL state", async () => {
    window.history.replaceState({ key: 'value' }, '', '/settings?tab=banking&bankError=cancelled#section');
    render(<BankConnectionsPanel />);
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Info', expect.stringContaining('cancelled')));
    expect(toast.error).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/settings?tab=banking#section');
    expect(window.history.state).toEqual({ key: 'value' });
  });

  it('uses safe failure feedback for untrusted callback text', async () => {
    window.history.replaceState({}, '', '/settings?bankError=sensitive-provider-detail');
    render(<BankConnectionsPanel />);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain('sensitive-provider-detail');
  });

  it('explains extended history authentication and safely handles a bank-list network failure', async () => {
    const { listBankAspsps } = await import('@/lib/actions/bank');
    vi.mocked(listBankAspsps).mockRejectedValueOnce(new Error('sensitive-provider-detail'));
    render(<BankConnectionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a bank' }));
    expect(await screen.findByText(/access older transaction history/i)).toBeInTheDocument();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error', 'Could not load banks. Please try again.'));
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain('sensitive-provider-detail');
  });
});

describe('bank transaction reference review', () => {
  it('shows a review warning on the affected connection', async () => {
    const { getBankConnections } = await import('@/lib/actions/bank');
    const original = await getBankConnections();
    vi.mocked(getBankConnections).mockResolvedValueOnce({
      success: true,
      data: original.data!.map(connection => ({ ...connection, lastSyncStatus: 'error', lastError: 'TRANSACTION_REFERENCE_CHANGED' })),
    });
    render(<BankConnectionsPanel />);
    expect(await screen.findByText(/transaction may have changed its reference/i)).toBeInTheDocument();
    expect(screen.queryByText(/TRANSACTION_REFERENCE_CHANGED/)).not.toBeInTheDocument();
  });

  it('does not announce a successful refresh when an account requires review', async () => {
    const { refreshBankConnection } = await import('@/lib/actions/bank');
    vi.mocked(refreshBankConnection).mockResolvedValueOnce({
      success: true,
      data: { id: 'run', connectionId: 'synthetic-bank', trigger: 'manual', startedAt: '2026-01-01', status: 'partial', psuPresent: false,
        perAccount: [{ linkedAccountId: 'synthetic-link', balanceFetched: false, txAdded: 0, txUpdated: 0, error: 'TRANSACTION_REFERENCE_CHANGED' }] },
    });
    render(<BankConnectionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error', expect.stringContaining('transaction may have changed its reference')));
    expect(toast.success).not.toHaveBeenCalledWith('Done', 'Refreshed');
  });
});

describe('bank refresh and callback success feedback', () => {
  it('shows a percent sign in the connected bank name without decoding twice', async () => {
    window.history.replaceState({}, '', '/settings?tab=banking&bankConnected=100%25%20Bank');
    render(<BankConnectionsPanel />);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Done', 'Connected 100% Bank — syncing your accounts'));
    expect(window.location.search).toBe('?tab=banking');
  });

  it('reports a partial refresh as a failure instead of success', async () => {
    const { refreshBankConnection } = await import('@/lib/actions/bank');
    vi.mocked(refreshBankConnection).mockResolvedValueOnce({
      success: true,
      data: { id: 'run', connectionId: 'synthetic-bank', trigger: 'manual', startedAt: '2026-01-01', status: 'partial', psuPresent: false, perAccount: [] },
    });
    render(<BankConnectionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error', expect.stringContaining('did not complete')));
    expect(toast.success).not.toHaveBeenCalledWith('Done', 'Refreshed');
    expect(screen.getByRole('button', { name: 'Refresh now' })).not.toBeDisabled();
  });

  it('recovers the refresh control after a network exception', async () => {
    const { refreshBankConnection } = await import('@/lib/actions/bank');
    vi.mocked(refreshBankConnection).mockRejectedValueOnce(new Error('network detail'));
    render(<BankConnectionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error', 'Bank refresh failed. Please try again.'));
    expect(screen.getByRole('button', { name: 'Refresh now' })).not.toBeDisabled();
  });
});
