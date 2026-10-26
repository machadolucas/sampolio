// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { InputNumber } from './input-number';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function AmountForm({ onSave }: { onSave: (value: number | null) => void }) {
  const [value, setValue] = useState<number | null>(null);
  const submit = useFormSubmit(() => onSave(value));
  return (
    <form onSubmit={submit}>
      <label htmlFor="amount">Amount</label>
      <InputNumber
        inputId="amount"
        value={value}
        onValueChange={(event) => setValue(event.value)}
        mode="currency"
        currency="EUR"
      />
      <button type="submit">Save</button>
    </form>
  );
}
describe('localized number field', () => {
  it('submits typed Finnish money without requiring a separate blur', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    render(<AmountForm onSave={save} />);
    const input = screen.getByLabelText('Amount');
    input.focus();
    fireEvent.change(input, { target: { value: '1 234,50' } });
    fireEvent.submit(input.closest('form')!);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(save).toHaveBeenLastCalledWith(1234.5);
  });
  it('clears an optional value to null and preserves typed zero', async () => {
    const change = vi.fn();
    render(
      <InputNumber aria-label="Amount" value={12} onValueChange={change} />,
    );
    const input = screen.getByLabelText('Amount');
    fireEvent.change(input, { target: { value: '' } });
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: null }),
    );
    fireEvent.change(input, { target: { value: '0' } });
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: 0 }),
    );
  });
});

describe('financial input commit interactions', () => {
  it('accepts NBSP grouping and a currency suffix pasted before clicking Save', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<AmountForm onSave={save} />);
    await user.click(screen.getByLabelText('Amount'));
    await user.paste('1\u202f234,50\u00a0€');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(save).toHaveBeenLastCalledWith(1234.5);
  });
  it('commits a negative decimal and rounds currency precision on Enter', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<AmountForm onSave={save} />);
    await user.click(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '-12,345');
    await user.keyboard('{Enter}');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(save).toHaveBeenLastCalledWith(-12.35);
  });
  it('clamps a typed amount to its configured bound when committed', async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    function Bounded() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <>
          <InputNumber
            aria-label="Bounded amount"
            value={value}
            min={0}
            max={100}
            maxFractionDigits={2}
            onValueChange={(event) => setValue(event.value)}
            onValueCommitted={commit}
          />
          <button type="button">Done</button>
        </>
      );
    }
    render(<Bounded />);
    await user.type(screen.getByLabelText('Bounded amount'), '123,456');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: 100 }),
    );
  });
});
