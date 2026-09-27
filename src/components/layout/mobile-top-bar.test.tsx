// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { MobileTopBar } from './mobile-top-bar';

describe('MobileTopBar demo pill', () => {
  it('renders the demo pill in the bar, separate from Search, and exits demo on tap', () => {
    const onExitDemo = vi.fn();
    const onOpenCommandPalette = vi.fn();
    renderWithProviders(
      <MobileTopBar onOpenMenu={vi.fn()} onOpenCommandPalette={onOpenCommandPalette} demoMode onExitDemo={onExitDemo} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    expect(onExitDemo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Demo mode active/ }));
    expect(onExitDemo).toHaveBeenCalledTimes(1);
  });

  it('shows no pill when demo mode is off', () => {
    renderWithProviders(<MobileTopBar onOpenMenu={vi.fn()} onOpenCommandPalette={vi.fn()} onExitDemo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Demo mode active/ })).toBeNull();
  });
});
