'use client';
import { Dialog as Primitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
export function Sidebar({
  visible,
  onHide,
  position = 'left',
  header,
  children,
  className,
  style,
  dismissable = true,
  showCloseIcon = true,
  modal = true,
}: {
  visible: boolean;
  onHide: () => void;
  position?: 'left' | 'right' | 'top' | 'bottom';
  header?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  dismissable?: boolean;
  showCloseIcon?: boolean;
  blockScroll?: boolean;
  modal?: boolean;
}) {
  return (
    <Primitive.Root
      open={visible}
      modal={modal}
      onOpenChange={(open, details) => {
        if (!open) {
          if (details.reason === 'outside-press' && !dismissable) {
            details.cancel();
            return;
          }
          onHide();
        }
      }}
    >
      <Primitive.Portal>
        <Primitive.Backdrop className="ui-backdrop" />
        <Primitive.Popup
          aria-describedby={undefined}
          className={cn('ui-sheet', `ui-sheet-${position}`, className)}
          style={style}
        >
          <header className="ui-dialog-header">
            <Primitive.Title className="flex-1 font-semibold">
              {header ?? <span className="sr-only">Details</span>}
            </Primitive.Title>
            {showCloseIcon && (
              <Primitive.Close
                render={
                  <Button
                    variant="ghost"
                    icon={<X />}
                    aria-label="Close panel"
                  />
                }
              />
            )}
          </header>
          <div className="ui-sheet-content min-h-0 flex-1 overflow-y-auto p-4">
            {children}
          </div>
        </Primitive.Popup>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
export const Sheet = Sidebar;
