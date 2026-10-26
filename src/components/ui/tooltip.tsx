'use client';

import { Tooltip as Primitive } from '@base-ui/react/tooltip';
import { useState, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

export interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  event?: 'both' | 'hover' | 'focus';
}
/** Explicit trigger composition: no document-wide selectors or hidden receivers. */
export function Tooltip({
  children,
  content,
  position = 'top',
  className,
  event = 'both',
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <Primitive.Provider delay={400}>
      <Primitive.Root open={open} onOpenChange={setOpen}>
        <Primitive.Trigger
          render={children}
          closeOnClick={event !== 'both'}
          onClick={() => {
            if (event === 'both') setOpen((current) => !current);
          }}
        />
        <Primitive.Portal>
          <Primitive.Positioner
            side={position}
            sideOffset={7}
            className="ui-popover-positioner"
          >
            <Primitive.Popup className={cn('ui-tooltip', className)}>
              {content}
            </Primitive.Popup>
          </Primitive.Positioner>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
