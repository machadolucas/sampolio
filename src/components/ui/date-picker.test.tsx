// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Calendar, localDateValue } from './date-picker';

afterEach(cleanup);
describe('local date controls', () => {
  it('preserves a month as the local first day and clears to null', () => {
    const change = vi.fn();
    render(
      <Calendar
        aria-label="Month"
        view="month"
        value={new Date(2026, 9, 1)}
        onChange={change}
      />,
    );
    const input = screen.getByLabelText('Month');
    fireEvent.change(input, { target: { value: '2027-01' } });
    const date = change.mock.calls[0][0].value as Date;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([
      2027, 0, 1,
    ]);
    fireEvent.change(input, { target: { value: '' } });
    expect(change).toHaveBeenLastCalledWith({ value: null });
  });
  it('round-trips trip local datetime without shifting hours', () => {
    const change = vi.fn();
    render(<Calendar aria-label="Start" showTime onChange={change} />);
    fireEvent.change(screen.getByLabelText('Start'), {
      target: { value: '2026-10-25T03:30' },
    });
    expect(localDateValue(change.mock.calls[0][0].value, true)).toBe(
      '2026-10-25T03:30',
    );
  });
  it('supports typed day dates and an explicit clear action', () => {
    const change = vi.fn();
    render(
      <Calendar
        aria-label="Date"
        value={new Date(2026, 9, 26)}
        dateFormat="dd.mm.yy"
        onChange={change}
      />,
    );
    const input = screen.getByLabelText('Date');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '31.12.2026' } });
    expect(localDateValue(change.mock.calls[0][0].value)).toBe('2026-12-31');
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(change).toHaveBeenLastCalledWith({ value: null });
  });
});
