// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Dropdown, MultiSelect } from './select';

afterEach(cleanup);
describe('scalar selection', () => {
  it('returns null for a sentinel option rather than leaking its option object', async () => {
    const change = vi.fn();
    function Picker() {
      const [value, setValue] = useState<string | null>('cash');
      return (
        <Dropdown
          aria-label="Account"
          value={value}
          options={[
            { label: 'Cash', value: 'cash' },
            { label: 'Not linked', value: null },
          ]}
          onChange={(event) => {
            change(event.value);
            setValue(event.value);
          }}
        />
      );
    }
    render(<Picker />);
    fireEvent.click(screen.getByLabelText('Account'));
    fireEvent.click(await screen.findByRole('option', { name: 'Not linked' }));
    expect(change).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('Account')).toHaveTextContent('Not linked');
  });
  it('preserves zero-valued selections and clears explicitly', () => {
    const change = vi.fn();
    render(
      <Dropdown
        aria-label="Count"
        value={0}
        options={[
          { label: 'Zero', value: 0 },
          { label: 'One', value: 1 },
        ]}
        showClear
        onChange={change}
      />,
    );
    expect(screen.getByLabelText('Count')).toHaveTextContent('Zero');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(change).toHaveBeenLastCalledWith({ value: null });
  });
});

describe('grouped selection', () => {
  it('keeps visible accessible group labels and returns the child scalar value', async () => {
    const change = vi.fn();
    render(
      <Dropdown
        aria-label="Item"
        value={null}
        options={[
          { label: 'Income', items: [{ label: 'Salary', value: 'salary' }] },
          { label: 'Expenses', items: [{ label: 'Rent', value: 'rent' }] },
        ]}
        optionGroupLabel="label"
        optionGroupChildren="items"
        optionLabel="label"
        optionValue="value"
        onChange={change}
      />,
    );
    fireEvent.click(screen.getByLabelText('Item'));
    expect(await screen.findByText('Income')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Rent' }));
    expect(change).toHaveBeenLastCalledWith({ value: 'rent' });
  });
});

describe('multiple selection', () => {
  it('searches, selects multiple scalar values and can deselect to empty', async () => {
    const change = vi.fn();
    function Categories() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <MultiSelect
          aria-label="Categories"
          value={value}
          filter
          display="chip"
          options={[
            { label: 'Food', value: 'food' },
            { label: 'Travel', value: 'travel' },
          ]}
          onChange={(event) => {
            change(event.value);
            setValue(event.value);
          }}
        />
      );
    }
    render(<Categories />);
    fireEvent.click(screen.getByLabelText('Categories'));
    const search = await screen.findByLabelText('Search options');
    fireEvent.change(search, { target: { value: 'food' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Food' }));
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Travel' }));
    expect(change).toHaveBeenLastCalledWith(['food', 'travel']);
    fireEvent.click(screen.getByRole('option', { name: 'Food' }));
    fireEvent.click(screen.getByRole('option', { name: 'Travel' }));
    expect(change).toHaveBeenLastCalledWith([]);
  });
});
