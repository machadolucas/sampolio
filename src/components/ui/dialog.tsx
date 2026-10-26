'use client';
import { Dialog as Primitive } from '@base-ui/react/dialog';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
export interface DialogProps {
  visible: boolean;
  onHide: () => void;
  header?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  maximizable?: boolean;
  maximized?: boolean;
  onMaximize?: (event: { maximized: boolean }) => void;
  dismissableMask?: boolean;
  closeOnEscape?: boolean;
  closable?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  modal?: boolean;
  blockScroll?: boolean;
  breakpoints?: Record<string, string>;
  position?: string;
  id?: string;
  'aria-label'?: string;
}
export function Dialog({
  visible,
  onHide,
  header,
  children,
  footer,
  className,
  style,
  contentClassName,
  contentStyle,
  maximizable,
  maximized,
  onMaximize,
  dismissableMask = false,
  closeOnEscape = true,
  closable = true,
  id,
  'aria-label': label,
}: DialogProps) {
  const [max, setMax] = useState(false);
  const full = maximized ?? max;
  return (
    <Primitive.Root
      open={visible}
      onOpenChange={(open, details) => {
        if (!open) {
          if (details.reason === 'outside-press' && !dismissableMask) {
            details.cancel();
            return;
          }
          if (details.reason === 'escape-key' && !closeOnEscape) {
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
          id={id}
          aria-label={header ? undefined : (label ?? 'Dialog')}
          aria-describedby={undefined}
          className={cn('ui-dialog', full && 'ui-dialog-maximized', className)}
          style={full ? undefined : style}
        >
          <header className="ui-dialog-header">
            <Primitive.Title className="min-w-0 flex-1 text-lg font-semibold">
              {header ?? label ?? 'Dialog'}
            </Primitive.Title>
            <div className="flex shrink-0 gap-1">
              {maximizable && (
                <Button
                  variant="ghost"
                  aria-label={full ? 'Restore dialog size' : 'Maximize dialog'}
                  icon={full ? <Minimize2 /> : <Maximize2 />}
                  onClick={() => {
                    setMax(!full);
                    onMaximize?.({ maximized: !full });
                  }}
                />
              )}
              {closable && (
                <Primitive.Close
                  render={
                    <Button
                      variant="ghost"
                      aria-label="Close dialog"
                      icon={<X />}
                    />
                  }
                />
              )}
            </div>
          </header>
          <div
            className={cn('ui-dialog-content', contentClassName)}
            style={contentStyle}
          >
            {children}
          </div>
          {footer && <footer className="ui-dialog-footer">{footer}</footer>}
        </Primitive.Popup>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
export { Primitive as DialogPrimitive };
