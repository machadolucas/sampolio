// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  ConfirmDialog,
  cancelConfirmations,
  confirmDialog,
  requestConfirmation,
} from './confirmation';

afterEach(() => {
  cancelConfirmations();
  cleanup();
  vi.useRealTimers();
});
describe('global confirmation queue', () => {
  it('answers queued prompts once and dismisses before continuation', async () => {
    render(<ConfirmDialog />);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = requestConfirmation({ message: 'First prompt' });
      second = requestConfirmation({ message: 'Second prompt' });
    });
    expect(screen.getByText('First prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await first).toBe(true);
    expect(await screen.findByText('Second prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await second).toBe(false);
  });
  it('allows an accept callback to await another prompt without deadlock', async () => {
    const callback = vi.fn(async () => {
      await requestConfirmation({ message: 'Nested prompt' });
    });
    render(<ConfirmDialog />);
    act(() => confirmDialog({ message: 'Outer prompt', accept: callback }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await screen.findByText('Nested prompt');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nested prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });
  it('resolves pending prompts false when the host unmounts', async () => {
    const view = render(<ConfirmDialog />);
    let pending!: Promise<boolean>;
    act(() => {
      pending = requestConfirmation({ message: 'Pending' });
    });
    view.unmount();
    expect(await pending).toBe(false);
  });
});

it('does not let a double activation accept the next queued prompt', async () => {
  const user = userEvent.setup();
  const secondAnswer = vi.fn();
  render(<ConfirmDialog />);
  let first!: Promise<boolean>;
  act(() => {
    first = requestConfirmation({ message: 'First safety gate' });
    void requestConfirmation({ message: 'Second safety gate' }).then(
      secondAnswer,
    );
  });
  await user.dblClick(screen.getByRole('button', { name: 'Confirm' }));
  expect(await first).toBe(true);
  expect(await screen.findByText('Second safety gate')).toBeInTheDocument();
  expect(secondAnswer).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus(),
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(secondAnswer).toHaveBeenCalledWith(false);
});

it('preserves legacy confirmation labels and accept focus by default', async () => {
  render(<ConfirmDialog />);
  act(() => confirmDialog({ message: 'Legacy prompt' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus(),
  );
  expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  );
  act(() =>
    confirmDialog({
      message: 'Custom prompt',
      acceptLabel: 'Remove',
      rejectLabel: 'Keep',
      defaultFocus: 'reject',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus(),
  );
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
});
