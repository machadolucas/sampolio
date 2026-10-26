'use client';

import { useCallback, useSyncExternalStore } from 'react';
const values = new Map<string, boolean>();
const EVENT = 'sampolio-device-preference';
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(EVENT, listener);
  };
};
const serverValue = () => false;
const ready = () => true;
const noopSubscribe = () => () => {};
export function useDevicePreferencesReady() {
  return useSyncExternalStore(noopSubscribe, ready, serverValue);
}
/** SSR always uses the same default; subscribers resolve storage before private views mount. */
export function useDeviceBoolean(key: string, enabledValue = 'true') {
  const read = useCallback(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null
        ? (values.get(key) ?? false)
        : stored === enabledValue;
    } catch {
      return values.get(key) ?? false;
    }
  }, [key, enabledValue]);
  const value = useSyncExternalStore(subscribe, read, serverValue);
  const setValue = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(read()) : next;
      values.set(key, resolved);
      try {
        localStorage.setItem(
          key,
          resolved ? enabledValue : enabledValue === '1' ? '0' : 'false',
        );
      } catch {}
      window.dispatchEvent(new Event(EVENT));
    },
    [key, enabledValue, read],
  );
  return [value, setValue] as const;
}
