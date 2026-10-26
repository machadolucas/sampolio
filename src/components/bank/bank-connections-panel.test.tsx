// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
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
