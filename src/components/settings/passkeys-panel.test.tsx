// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  updatePasskey: vi.fn(),
  deletePasskey: vi.fn(),
  signOut: vi.fn(),
  listMyPasskeys: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    passkey: { addPasskey: mocks.addPasskey, updatePasskey: mocks.updatePasskey, deletePasskey: mocks.deletePasskey },
    signOut: mocks.signOut,
  },
}));
vi.mock('@/lib/actions/account', () => ({ listMyPasskeys: mocks.listMyPasskeys }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn(), show: vi.fn() }),
}));

import { PasskeysPanel } from './passkeys-panel';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function PublicKeyCredential() {} });
  mocks.listMyPasskeys.mockResolvedValue({
    success: true,
    data: [
      { id: 'pk1', name: 'iCloud Keychain', deviceType: 'multiDevice', backedUp: true, createdAt: '2026-09-01T10:00:00.000Z', lastUsedAt: '2026-09-20T10:00:00.000Z' },
    ],
  });
  mocks.signOut.mockResolvedValue({ data: { success: true } });
});

describe('PasskeysPanel', () => {
  it('lists passkeys with their dates', async () => {
    renderWithProviders(<PasskeysPanel isDark={false} />);
    expect(await screen.findByText('iCloud Keychain')).toBeInTheDocument();
    expect(screen.getByText(/Added .* · Last used /)).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('asks to sign in again when registration needs a fresh session', async () => {
    mocks.addPasskey.mockResolvedValue({
      data: null,
      error: { code: 'PASSKEY_REAUTH_REQUIRED', status: 403, message: 'For security, sign in again to add a passkey.' },
    });
    renderWithProviders(<PasskeysPanel isDark={false} />);
    await screen.findByText('iCloud Keychain');

    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    expect(await screen.findByText('For security, sign in again to add a passkey.')).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/auth/signin?callbackUrl=%2Fsettings%3Ftab%3Daccount'));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('adds a passkey and reloads the list', async () => {
    mocks.addPasskey.mockResolvedValue({ data: { id: 'pk2' }, error: null });
    renderWithProviders(<PasskeysPanel isDark={false} />);
    await screen.findByText('iCloud Keychain');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Passkey added', expect.any(String)));
    expect(mocks.listMyPasskeys).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the user cancels the browser prompt', async () => {
    mocks.addPasskey.mockResolvedValue({ data: null, error: { code: 'ERROR_CEREMONY_ABORTED', message: 'cancelled' } });
    renderWithProviders(<PasskeysPanel isDark={false} />);
    await screen.findByText('iCloud Keychain');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    await waitFor(() => expect(mocks.addPasskey).toHaveBeenCalled());
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText('For security, sign in again to add a passkey.')).not.toBeInTheDocument();
  });
});
