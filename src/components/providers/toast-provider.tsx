'use client';

import { Toast } from '@base-ui/react/toast';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { Button } from '../ui/button';

export interface ToastMessage {
  severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast';
  summary?: ReactNode;
  detail?: ReactNode;
  life?: number;
  sticky?: boolean;
}
interface ToastContextValue {
  show: (message: ToastMessage | ToastMessage[]) => void;
  success: (summary: string, detail?: string) => void;
  error: (summary: string, detail?: string) => void;
  info: (summary: string, detail?: string) => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);
function ToastSurface({ children }: { children: ReactNode }) {
  const manager = Toast.useToastManager();
  const add = manager.add;
  const show = useCallback(
    (input: ToastMessage | ToastMessage[]) => {
      for (const message of Array.isArray(input) ? input : [input]) {
        add({
          title: message.summary,
          description: message.detail,
          type: message.severity,
          priority: message.severity === 'error' ? 'high' : 'low',
          timeout: message.sticky ? 0 : (message.life ?? 3000),
        });
      }
    },
    [add],
  );
  const value = useMemo(
    () => ({
      show,
      success: (summary: string, detail?: string) =>
        show({ severity: 'success', summary, detail, life: 2000 }),
      error: (summary: string, detail?: string) =>
        show({ severity: 'error', summary, detail, life: 5000 }),
      info: (summary: string, detail?: string) =>
        show({ severity: 'info', summary, detail, life: 3000 }),
    }),
    [show],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="ui-toast-viewport">
          {manager.toasts.map((toast) => (
            <Toast.Root
              key={toast.id}
              toast={toast}
              className="ui-toast"
              data-tone={toast.type}
            >
              <Toast.Content className="flex items-start gap-3">
                <span className="mt-1 shrink-0" aria-hidden="true">
                  {toast.type === 'success' ? (
                    <CheckCircle2 size={20} />
                  ) : toast.type === 'error' || toast.type === 'warn' ? (
                    <CircleAlert size={20} />
                  ) : (
                    <Info size={20} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <Toast.Title className="font-semibold" />
                  <Toast.Description className="mt-0.5 text-sm opacity-80" />
                </div>
                <Toast.Close
                  render={
                    <Button
                      variant="ghost"
                      icon={<X />}
                      aria-label="Dismiss notification"
                    />
                  }
                />
              </Toast.Content>
            </Toast.Root>
          ))}
        </Toast.Viewport>
      </Toast.Portal>
    </ToastContext.Provider>
  );
}
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={4}>
      <ToastSurface>{children}</ToastSurface>
    </Toast.Provider>
  );
}
const noop: ToastContextValue = {
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
};
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? noop;
}
