'use client';
import type { ReactNode } from 'react';
import { cn } from './cn';
export function Steps({
  model,
  activeIndex = 0,
  readOnly = true,
  onSelect,
  className,
}: {
  model: { label?: ReactNode; disabled?: boolean }[];
  activeIndex?: number;
  readOnly?: boolean;
  onSelect?: (event: { index: number }) => void;
  className?: string;
}) {
  return (
    <ol
      aria-label="Progress"
      className={cn('mb-6 flex min-w-0 gap-1 overflow-x-auto', className)}
    >
      {model.map((item, index) => (
        <li
          key={index}
          aria-current={index === activeIndex ? 'step' : undefined}
          className="min-w-0 flex-1"
        >
          <button
            type="button"
            disabled={readOnly || item.disabled}
            onClick={() => onSelect?.({ index })}
            className={cn(
              'flex min-h-11 w-full flex-col items-center gap-1 text-center text-xs',
              index === activeIndex ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full',
                index <= activeIndex
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted',
              )}
            >
              {index + 1}
            </span>
            <span>{item.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
