// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InputSwitch, Checkbox, SelectButton } from './controls';

describe('native labelled controls', () => {
  it('labels the actual switch and checkbox, including after a remount', () => {
    const change = vi.fn();
    const contents = (
      <>
        <label htmlFor="theme-switch">Dark Mode</label>
        <InputSwitch inputId="theme-switch" checked onChange={change} />
        <label htmlFor="terms">Terms</label>
        <Checkbox inputId="terms" checked={false} onChange={change} />
      </>
    );
    const view = render(contents);
    expect(screen.getByRole('switch', { name: 'Dark Mode' })).toBeChecked();
    fireEvent.click(screen.getByLabelText('Dark Mode'));
    expect(change).toHaveBeenLastCalledWith({ value: false });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terms' }));
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ checked: true }),
    );
    view.unmount();
    render(contents);
    expect(screen.getByRole('switch', { name: 'Dark Mode' })).toBeChecked();
  });
});

it('preserves legacy segmented selection clearing unless explicitly required', () => {
  const onChange = vi.fn();
  const options = [{ label: 'Monthly', value: 'monthly' }];
  const view = render(
    <SelectButton value="monthly" options={options} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
  expect(onChange).toHaveBeenLastCalledWith({ value: null });
  onChange.mockClear();
  view.rerender(
    <SelectButton
      value="monthly"
      options={options}
      onChange={onChange}
      allowEmpty={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
  expect(onChange).not.toHaveBeenCalled();
});
