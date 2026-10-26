// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Calendar, localDateValue } from './date-picker';
import { getDefaultClassNames } from '@daypicker/react';

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

it('retains DayPicker navigation geometry classes while moving and selecting months', () => {
  const change = vi.fn();
  const { container } = render(
    <Calendar inline value={new Date(2026, 9, 26)} onChange={change} />,
  );
  const defaults = getDefaultClassNames();
  const nav = container.querySelector('nav')!;
  expect(nav).toHaveClass(defaults.nav);
  const previous = nav.querySelector(`.${defaults.button_previous}`)!;
  const next = nav.querySelector(`.${defaults.button_next}`)!;
  expect(previous).toHaveClass('ui-calendar-nav-button');
  expect(next).toHaveClass('ui-calendar-nav-button');
  expect(previous).not.toHaveClass('ui-button');
  expect(next).not.toHaveClass('ui-button');
  expect(
    container.querySelector(`.${defaults.month_caption}`),
  ).toHaveTextContent('lokakuu 2026');
  fireEvent.click(next);
  expect(
    container.querySelector(`.${defaults.month_caption}`),
  ).toHaveTextContent('marraskuu 2026');
  fireEvent.click(previous);
  expect(
    container.querySelector(`.${defaults.month_caption}`),
  ).toHaveTextContent('lokakuu 2026');
  const day = container.querySelector(`.${defaults.day_button}[tabindex="0"]`)!;
  expect(day).toHaveClass('ui-calendar-day');
  const anotherDay = Array.from(
    container.querySelectorAll(`.${defaults.day_button}`),
  ).find((button) => button.textContent === '27')!;
  fireEvent.click(anotherDay);
  expect(localDateValue(change.mock.calls[0][0].value)).toBe('2026-10-27');
});

it('anchors an input-opened calendar without an icon and keeps typed entry working', async () => {
  const change = vi.fn();
  render(
    <Calendar aria-label="No-icon date" showIcon={false} onChange={change} />,
  );
  expect(
    screen.queryByRole('button', { name: 'Choose date' }),
  ).not.toBeInTheDocument();
  const input = screen.getByRole('textbox', { name: 'No-icon date' });
  fireEvent.focus(input);
  fireEvent.click(input);
  expect(
    await screen.findByRole('dialog', { name: 'Choose date' }),
  ).toBeInTheDocument();
  fireEvent.change(input, { target: { value: '27.10.2026' } });
  expect(localDateValue(change.mock.calls[0][0].value)).toBe('2026-10-27');
});
