// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { HelpHint } from './help-hint';

describe('HelpHint', () => {
  it('has an accessible name and exposes the help text as its description', () => {
    renderWithProviders(<HelpHint text="Money you expect to have left." />);
    const button = screen.getByRole('button', { name: 'What does this mean?' });
    expect(button).toHaveAccessibleDescription('Money you expect to have left.');
  });

  it('accepts a custom accessible label', () => {
    renderWithProviders(<HelpHint text="Explained." ariaLabel="About net worth" />);
    expect(screen.getByRole('button', { name: 'About net worth' })).toBeInTheDocument();
  });

  it('enlarges the hit area with a pseudo-element instead of padding (no layout shift)', () => {
    renderWithProviders(<HelpHint text="Explained." />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('before:-inset-3.5');
    expect(button.className).toContain('relative');
    expect(button.className).not.toMatch(/(^|\s)p-\d/);
  });
});
