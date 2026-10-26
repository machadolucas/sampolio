'use client';

import { useCallback, useLayoutEffect, useRef, type FormEvent } from 'react';

/**
 * `onSubmit` handler for dialog forms so Enter (or a mobile keyboard's "Go")
 * saves like the primary button does.
 *
 * The localized number field commits typed text only on blur/Enter, so the submit event can fire before the amount state has
 * updated. The handler therefore blurs a focused number field first (which
 * commits it), then runs the LATEST `submit` on the next tick, after React has
 * applied the committed value. Textareas keep Enter for new lines (native behaviour).
 */
export function useFormSubmit(
  submit: () => unknown,
  opts: { disabled?: boolean } = {},
) {
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  });
  const disabled = opts.disabled ?? false;
  return useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (disabled) return;
      const active =
        typeof document !== 'undefined' ? document.activeElement : null;
      // Only a focused number field needs committing; other fields keep focus.
      if (
        active instanceof HTMLElement &&
        e.currentTarget.contains(active) &&
        active.closest('[data-commit-on-submit]')
      ) {
        active.blur();
      }
      setTimeout(() => {
        void submitRef.current();
      }, 0);
    },
    [disabled],
  );
}
