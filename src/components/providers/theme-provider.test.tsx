// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { ThemeProvider, useTheme } from './theme-provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-reduce-transparency');
});
function Appearance() {
  const theme = useTheme();
  return (
    <>
      <p>Visible server shell</p>
      <output>{theme.theme}</output>
      <button type="button" onClick={theme.toggleTheme}>
        Toggle theme
      </button>
      <button type="button" onClick={() => theme.setReducedTransparency(true)}>
        Solid surfaces
      </button>
    </>
  );
}
describe('appearance provider', () => {
  it('renders SSR children and respects system appearance plus in-memory changes when storage is denied', () => {
    expect(
      renderToString(
        <ThemeProvider>
          <Appearance />
        </ThemeProvider>,
      ),
    ).toContain('Visible server shell');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage denied');
    });
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
    render(
      <ThemeProvider>
        <Appearance />
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveClass('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(screen.getByText('light', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Solid surfaces' }));
    expect(document.documentElement).toHaveAttribute(
      'data-reduce-transparency',
    );
  });
});
