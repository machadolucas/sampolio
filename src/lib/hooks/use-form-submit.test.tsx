// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFormSubmit } from './use-form-submit';

/** Mimics PrimeReact InputNumber: the value is committed only on blur. */
function CommitOnBlurForm({ onSave }: { onSave: (v: number | null) => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const onSubmit = useFormSubmit(() => onSave(amount));
  return (
    <form onSubmit={onSubmit}>
      <span className="p-inputnumber">
        <input aria-label="Amount" defaultValue="" onBlur={(e) => setAmount(Number(e.target.value))} />
      </span>
      <input aria-label="Name" defaultValue="" />
      <button type="button">Cancel</button>
      <button type="submit">Save</button>
    </form>
  );
}

describe('useFormSubmit', () => {
  it('commits the focused field (blur) before running the latest submit', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(<CommitOnBlurForm onSave={onSave} />);
    const input = screen.getByLabelText('Amount');
    input.focus();
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.submit(input.closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { vi.runAllTimers(); });
    expect(onSave).toHaveBeenCalledWith(12.5);
    vi.useRealTimers();
  });

  it('does nothing while disabled', async () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    function Disabled() {
      const onSubmit = useFormSubmit(submit, { disabled: true });
      return <form onSubmit={onSubmit}><button type="submit">Save</button></form>;
    }
    render(<Disabled />);
    fireEvent.click(screen.getByText('Save'));
    await act(async () => { vi.runAllTimers(); });
    expect(submit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps focus in ordinary text fields', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(<CommitOnBlurForm onSave={onSave} />);
    const name = screen.getByLabelText('Name');
    name.focus();
    fireEvent.submit(name.closest('form')!);
    await act(async () => { vi.runAllTimers(); });
    expect(document.activeElement).toBe(name);
    expect(onSave).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
