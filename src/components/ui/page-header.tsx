import type { ReactNode } from 'react';
import { cn } from './cn';

interface RailProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** A bounded page heading; data and editable content remain in opaque cards. */
export function PageHeader({
  title,
  description,
  actions,
  leading,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-slot="page-header"
      className={cn('material-rail glass-chrome', className)}
    >
      <div className="flex min-w-0 flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {description && (
              <div className="mt-1 text-sm text-muted-foreground">
                {description}
              </div>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children && <div className="mt-4 min-w-0">{children}</div>}
    </header>
  );
}

export function MaterialToolbar({
  children,
  className,
  sticky = false,
  'aria-label': label,
}: RailProps & { sticky?: boolean }) {
  return (
    <div
      data-slot="material-toolbar"
      aria-label={label}
      role={label ? 'region' : undefined}
      className={cn(
        'material-rail glass-chrome flex min-w-0 flex-wrap items-center gap-3',
        sticky && 'material-rail-sticky',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Use inside an existing material surface: this rail never adds a blur layer. */
export function ControlGroup({
  children,
  className,
  'aria-label': label,
}: RailProps) {
  return (
    <div
      data-slot="control-group"
      aria-label={label}
      role={label ? 'region' : undefined}
      className={cn(
        'material-control-group flex min-w-0 flex-wrap items-center gap-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
