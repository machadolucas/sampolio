'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Button } from './button';
import { useToast } from '../providers/toast-provider';

export interface ConfirmationOptions {
  header?: ReactNode;
  style?: CSSProperties;
  className?: string;
  message: ReactNode;
  icon?: ReactNode;
  acceptLabel?: string;
  rejectLabel?: string;
  severity?: 'danger' | 'warning';
  acceptClassName?: string;
  rejectClassName?: string;
  defaultFocus?: 'accept' | 'reject';
  accept?: () => unknown | Promise<unknown>;
  reject?: () => unknown | Promise<unknown>;
}
let requestSequence = 0;
interface Request {
  id: number;
  options: ConfirmationOptions;
  resolve: (accepted: boolean) => void;
  focus: HTMLElement | null;
}
let queue: Request[] = [];
let activeRequest: Request | null = null;
let queueFrame: number | null = null;
let closingRequest: { request: Request; accepted: boolean } | null = null;
function advanceQueue() {
  if (!activeRequest && !closingRequest && queueFrame === null)
    activeRequest = queue.shift() ?? null;
}
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => activeRequest;
const serverSnapshot = () => null;

/** Single app-owned confirmation queue; every request receives one answer. */
export function requestConfirmation(
  options: ConfirmationOptions,
): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: ++requestSequence,
        options,
        resolve,
        focus:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      },
    ];
    advanceQueue();
    emit();
  });
}
export function confirmDialog(options: ConfirmationOptions) {
  void requestConfirmation({
    acceptLabel: 'Yes',
    rejectLabel: 'No',
    defaultFocus: 'accept',
    ...options,
  });
}
export function cancelConfirmations() {
  const pending = [
    ...queue,
    ...(activeRequest ? [activeRequest] : []),
    ...(closingRequest ? [closingRequest.request] : []),
  ];
  if (queueFrame !== null) cancelAnimationFrame(queueFrame);
  queueFrame = null;
  queue = [];
  activeRequest = null;
  closingRequest = null;
  pending.forEach((request) => request.resolve(false));
  emit();
}
export function ConfirmDialog() {
  const request = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const lastFocus = useRef<HTMLElement | null>(null);
  if (request) lastFocus.current = request.focus;
  const rejectRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  useEffect(() => cancelConfirmations, []);
  const answer = (accepted: boolean) => {
    if (!request || activeRequest !== request || closingRequest) return;
    activeRequest = null;
    closingRequest = { request, accepted };
    emit();
  };
  const afterClose = (open: boolean) => {
    if (open) {
      (request?.options.defaultFocus === 'accept'
        ? acceptRef.current
        : rejectRef.current
      )?.focus();
      return;
    }
    if (!closingRequest) return;
    const { request: finished, accepted } = closingRequest;
    closingRequest = null;
    // Resolve and run continuations only after a real closed focus boundary.
    queueFrame = requestAnimationFrame(() => {
      queueFrame = null;
      advanceQueue();
      emit();
    });
    finished.resolve(accepted);
    const callback = accepted
      ? finished.options.accept
      : finished.options.reject;
    if (callback)
      queueMicrotask(() => {
        void Promise.resolve()
          .then(callback)
          .catch((error) => {
            toast.error(
              'Could not complete the action',
              error instanceof Error ? error.message : 'Please try again.',
            );
          });
      });
    // The scheduled frame lets the closed portal finish focus cleanup.
    emit();
  };
  const options = request?.options;
  return (
    <AlertDialog.Root
      key={request?.id ?? closingRequest?.request.id ?? 0}
      open={Boolean(request)}
      onOpenChangeComplete={afterClose}
      onOpenChange={(open) => {
        if (!open) void answer(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="ui-backdrop ui-confirm-layer" />
        <AlertDialog.Popup
          className={`ui-dialog ui-confirm-layer ${options?.className ?? ''}`}
          style={options?.style}
          initialFocus={
            options?.defaultFocus === 'accept' ? acceptRef : rejectRef
          }
          finalFocus={lastFocus}
        >
          <header className="ui-dialog-header">
            <AlertDialog.Title className="text-lg font-semibold">
              {options?.header ?? 'Are you sure?'}
            </AlertDialog.Title>
          </header>
          <AlertDialog.Description
            render={<div />}
            className="ui-dialog-content"
          >
            {options?.message}
          </AlertDialog.Description>
          <footer className="ui-dialog-footer">
            <Button
              ref={rejectRef}
              label={options?.rejectLabel ?? 'Cancel'}
              variant="outline"
              className={options?.rejectClassName}
              onClick={(event) => {
                if (event.detail <= 1) answer(false);
              }}
            />
            <Button
              ref={acceptRef}
              label={options?.acceptLabel ?? 'Confirm'}
              severity={options?.severity}
              className={options?.acceptClassName}
              onClick={(event) => {
                if (event.detail <= 1) answer(true);
              }}
            />
          </footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
