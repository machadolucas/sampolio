// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useRef } from 'react';
import { ToastProvider, useToast } from './toast-provider';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Trigger() {
  const toast = useToast();
  const first = useRef(toast);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          toast.show([
            { severity: 'success', summary: 'Short notice', life: 100 },
            { severity: 'warn', summary: 'Keep this notice', sticky: true },
          ])
        }
      >
        Notify
      </button>
      <output>{first.current === toast ? 'Stable API' : 'Changed API'}</output>
    </>
  );
}
describe('global toast facade', () => {
  it('renders message arrays, keeps its API stable and retains sticky notices', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByText('Short notice')).toBeInTheDocument();
    expect(screen.getByText('Keep this notice')).toBeInTheDocument();
    expect(screen.getByText('Stable API')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Short notice')).not.toBeInTheDocument();
    expect(screen.getByText('Keep this notice')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.queryByText('Keep this notice')).not.toBeInTheDocument();
  });
});
