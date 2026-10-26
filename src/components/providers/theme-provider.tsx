'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';
interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  reducedTransparency: boolean;
  setReducedTransparency: (reduced: boolean) => void;
}
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const CHANGE_EVENT = 'sampolio-appearance-change';
const emptySubscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
let memoryTheme: Theme | null = null;
let memoryTransparency: boolean | null = null;
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function readTheme(): Theme {
  const saved = memoryTheme ?? stored('sampolio-theme');
  return saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
}
function readTransparency() {
  return (
    (memoryTransparency === null
      ? stored('sampolio-reduce-transparency')
      : String(memoryTransparency)) === 'true' ||
    window.matchMedia('(prefers-reduced-transparency: reduce)').matches
  );
}
function subscribe(listener: () => void) {
  const color = window.matchMedia('(prefers-color-scheme: dark)');
  const transparency = window.matchMedia(
    '(prefers-reduced-transparency: reduce)',
  );
  const onStorage = () => {
    memoryTheme = null;
    memoryTransparency = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  color.addEventListener('change', listener);
  transparency.addEventListener('change', listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
    color.removeEventListener('change', listener);
    transparency.removeEventListener('change', listener);
  };
}
function persist(key: string, value: string) {
  if (key === 'sampolio-theme') memoryTheme = value as Theme;
  if (key === 'sampolio-reduce-transparency')
    memoryTransparency = value === 'true';
  try {
    localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    clientReady,
    serverReady,
  );
  const theme = useSyncExternalStore(
    subscribe,
    readTheme,
    () => 'light' as Theme,
  );
  const reducedTransparency = useSyncExternalStore(
    subscribe,
    readTransparency,
    () => false,
  );
  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.style.colorScheme = next;
    persist('sampolio-theme', next);
  }, []);
  const setReducedTransparency = useCallback((reduced: boolean) => {
    document.documentElement.toggleAttribute(
      'data-reduce-transparency',
      reduced,
    );
    persist('sampolio-reduce-transparency', String(reduced));
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document.documentElement.toggleAttribute(
      'data-reduce-transparency',
      reducedTransparency,
    );
    for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
      meta.setAttribute('content', theme === 'dark' ? '#0F1412' : '#F3F6F4');
  }, [theme, reducedTransparency, hydrated]);
  const toggleTheme = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );
  const value = useMemo(
    () => ({
      theme,
      toggleTheme,
      setTheme,
      reducedTransparency,
      setReducedTransparency,
    }),
    [theme, toggleTheme, setTheme, reducedTransparency, setReducedTransparency],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
